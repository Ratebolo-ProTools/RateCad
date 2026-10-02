/**
 * AREA tool — AutoCAD-style area measurement using the shared Area / Boundary engines.
 * Temporary measurement never mutates permanent geometry unless the user opts in
 * (Create Boundary / Create Area Label).
 */

import type { CommandBus } from '@ratecad/commands';
import { CreatePolylineCommand, CreateTextCommand } from '@ratecad/commands';
import {
  getEntity,
  getSelectedEntities,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type LengthUnit,
  type Vec2,
} from '@ratecad/core';
import {
  addAreaEntry,
  areaFromEntity,
  areaFromPoints,
  areaMeasurementEngine,
  createAreaSession,
  defaultBoundaryTolerance,
  findBoundaryAtPoint,
  formatAreaResult,
  formatAreaSessionReport,
  formatWorldArea,
  pointInPolygon,
  polygonCentroid,
  previewAreaFromPoints,
  setAreaSessionMode,
  toAreaMeasurement,
  undoAreaEntry,
  type AreaComputation,
  type AreaResult,
  type AreaSessionMode,
} from '@ratecad/geometry';
import type { PreviewGeometry } from '@ratecad/viewport';
import { hitTestDocument, screenToleranceToWorld } from '@ratecad/viewport';
import type { PointerInput, ToolSession } from './session.js';
import { cancelTool, type AreaToolMode } from './session.js';

export type { AreaToolMode } from './session.js';
export function areaModeStatus(mode: AreaToolMode): string {
  switch (mode) {
    case 'object':
      return 'AREA · Object: select a closed shape';
    case 'points':
      return 'AREA · Points: click boundary points (Enter to finish)';
    case 'pick-inside':
      return 'AREA · Pick Inside: click inside an enclosed region';
    case 'room':
      return 'AREA · Room: click inside a room / wall loop';
    case 'add':
      return 'AREA · Add: select regions to add (Enter for total)';
    case 'subtract':
      return 'AREA · Subtract: select regions to subtract';
  }
}

export function setAreaToolMode(
  session: ToolSession,
  mode: AreaToolMode,
): ToolSession {
  const areaSession =
    mode === 'add' || mode === 'subtract'
      ? setAreaSessionMode(
          session.areaSession ?? createAreaSession(),
          mode === 'add' ? 'add' : 'subtract',
        )
      : session.areaSession ?? createAreaSession();
  return {
    ...cancelTool({ ...session, activeTool: 'area' }),
    activeTool: 'area',
    areaMode: mode,
    areaSession,
    areaLastResult: null,
    areaAwaitingOpen: null,
    statusMessage: areaModeStatus(mode),
    preview: null,
    previewEntities: null,
  };
}

function docUnits(doc: DrawingDocument): {
  world: LengthUnit;
  display: LengthUnit;
  precision: number;
} {
  return {
    world: doc.settings.worldUnit ?? 'ft',
    display: doc.settings.units,
    precision: doc.settings.precision ?? 2,
  };
}

function areaPreviewFromResult(result: AreaResult, cursor?: Vec2): PreviewGeometry {
  const c = cursor ?? polygonCentroid(result.outer);
  return {
    kind: 'area',
    start: c,
    end: c,
    vertices: result.outer,
    areaOuter: result.outer,
    areaHoles: result.holes,
  };
}

function formatResultStatus(
  result: AreaResult,
  doc: DrawingDocument,
  prefix = 'Area',
  entityType?: string,
): string {
  const u = docUnits(doc);
  const measurement = toAreaMeasurement(result, u.world, entityType);
  const fmt = areaMeasurementEngine.format(
    measurement,
    u.world,
    u.display,
    u.precision,
  );
  const holeNote =
    result.holes.length > 0
      ? ` · holes ${result.holes.length} (−${formatWorldArea(result.holesArea, u.world, u.display, u.precision)})`
      : '';
  return `${prefix}: ${fmt.summary}${holeNote}`;
}

/** Professional multi-line AREA result for command/status UI. */
export function formatAreaMeasurementReport(
  result: AreaResult,
  doc: DrawingDocument,
  entityType?: string,
): string[] {
  const u = docUnits(doc);
  const measurement = toAreaMeasurement(result, u.world, entityType);
  return areaMeasurementEngine.format(
    measurement,
    u.world,
    u.display,
    u.precision,
  ).lines;
}

/**
 * End a successful AREA measurement: keep last result visible, clear draw state.
 * Caller should activate Selection Mode + completeHandoff on the command engine.
 */
export function completeAreaMeasurement(session: ToolSession): ToolSession {
  return {
    ...cancelTool({ ...session, activeTool: 'select' }),
    activeTool: 'select',
    areaMode: session.areaMode,
    areaSession: session.areaSession,
    areaLastResult: session.areaLastResult,
    areaAwaitingOpen: null,
    statusMessage: session.statusMessage,
  };
}

/** Finish Add/Subtract session and keep net total in status. */
export function finishAreaSession(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const areaSession = session.areaSession;
  if (!areaSession || areaSession.entries.length === 0) {
    return {
      ...session,
      statusMessage: 'AREA: no regions in Add/Subtract session',
    };
  }
  const doc = bus.getDocument();
  const u = docUnits(doc);
  const report = formatAreaSessionReport(
    areaSession,
    u.world,
    u.display,
    u.precision,
  );
  const last = areaSession.entries[areaSession.entries.length - 1]!.result;
  return {
    ...completeAreaMeasurement({
      ...session,
      areaLastResult: last,
      statusMessage: report.join(' · '),
    }),
    areaSession,
    areaLastResult: last,
    statusMessage: report.join(' · '),
  };
}

function applyComputation(
  session: ToolSession,
  bus: CommandBus,
  computation: AreaComputation,
  label: string,
  entityType?: string,
): ToolSession {
  const doc = bus.getDocument();
  if (!computation.ok) {
    if (computation.code === 'open') {
      return {
        ...session,
        areaAwaitingOpen: {
          vertices: [],
          sourceId: undefined,
          message: computation.reason,
        },
        statusMessage: `${computation.reason} [C]=Close Temporarily · Esc=Cancel`,
        preview: null,
      };
    }
    return {
      ...session,
      areaLastResult: null,
      preview: null,
      statusMessage: computation.reason,
    };
  }

  let areaSession = session.areaSession ?? createAreaSession();
  const mode = session.areaMode;
  if (mode === 'add' || mode === 'subtract') {
    areaSession = setAreaSessionMode(
      areaSession,
      mode === 'add' ? 'add' : 'subtract',
    );
    areaSession = addAreaEntry(areaSession, computation, label);
    const u = docUnits(doc);
    const report = formatAreaSessionReport(
      areaSession,
      u.world,
      u.display,
      u.precision,
    );
    return {
      ...session,
      areaSession,
      areaLastResult: computation,
      areaAwaitingOpen: null,
      preview: areaPreviewFromResult(computation),
      statusMessage: `${report[report.length - 1]} · ${formatResultStatus(computation, doc, label, entityType)}`,
    };
  }

  // Object / points / pick-inside / room: one-shot successful measurement.
  const reportLines = formatAreaMeasurementReport(
    computation,
    doc,
    entityType,
  );
  return {
    ...session,
    areaLastResult: computation,
    areaAwaitingOpen: null,
    preview: areaPreviewFromResult(computation),
    statusMessage: reportLines.join(' · '),
  };
}

function resolveEntityArea(
  entity: Entity,
  forceClose = false,
): AreaComputation {
  return areaFromEntity(entity, { forceCloseOpenPolyline: forceClose });
}

export function handleAreaPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: import('@ratecad/geometry').SnapResult | null,
): ToolSession {
  const mode = session.areaMode ?? 'object';
  const doc = bus.getDocument();

  if (mode === 'points') {
    const verts = [...session.vertices, point];
    const live = previewAreaFromPoints(verts);
    const u = docUnits(doc);
    const status =
      verts.length < 3
        ? `AREA · Points: ${verts.length} point(s) — need ≥3`
        : live.valid
          ? `AREA preview · ${formatWorldArea(live.area, u.world, u.display, u.precision)} · peri ${live.perimeter.toFixed(u.precision)} — Enter to finish`
          : 'AREA · Points: self-intersecting — adjust points';
    return {
      ...session,
      mode: 'draw',
      anchor: point,
      vertices: verts,
      lastSnap: snap,
      preview:
        verts.length >= 2
          ? {
              kind: 'area',
              start: verts[0]!,
              end: point,
              vertices: verts,
              areaOuter: verts.length >= 3 ? verts : undefined,
            }
          : {
              kind: 'polyline',
              start: verts[0]!,
              end: point,
              vertices: verts,
            },
      statusMessage: status,
    };
  }

  if (mode === 'pick-inside' || mode === 'room') {
    const tol = defaultBoundaryTolerance(doc);
    const computation = findBoundaryAtPoint(doc, point, { tolerance: tol });
    if (!computation.ok && mode === 'room') {
      return {
        ...session,
        lastSnap: snap,
        preview: null,
        statusMessage: computation.reason,
      };
    }
    // Prefer named room label when clicking a room entity
    let label = mode === 'room' ? 'Room' : 'Boundary';
    if (computation.ok) {
      for (const e of doc.entities) {
        if (e.type !== 'room') continue;
        if (pointInPolygon(point, e.geometry.polygon)) {
          label = e.properties.name || 'Room';
          break;
        }
      }
    }
    const next = applyComputation(session, bus, computation, label, 'room');
    if (next.areaLastResult) {
      return {
        ...completeAreaMeasurement(next),
        areaLastResult: next.areaLastResult,
        statusMessage: next.statusMessage,
        preview: next.preview,
        lastSnap: snap,
      };
    }
    return {
      ...next,
      lastSnap: snap,
    };
  }

  // object / add / subtract — select entity
  const tol = screenToleranceToWorld(input.camera, 8);
  const id = hitTestDocument(doc, point, tol);
  if (!id) {
    // Also try pick-inside as fallback when add/subtract and miss
    if (mode === 'add' || mode === 'subtract') {
      const computation = findBoundaryAtPoint(doc, point, {
        tolerance: defaultBoundaryTolerance(doc),
      });
      return {
        ...applyComputation(session, bus, computation, 'Region'),
        lastSnap: snap,
      };
    }
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'AREA: click a closed object',
    };
  }

  const entity = getEntity(doc, id);
  if (!entity) {
    return { ...session, lastSnap: snap, statusMessage: 'AREA: object not found' };
  }

  const computation = resolveEntityArea(entity);
  if (!computation.ok && computation.code === 'open') {
    return {
      ...session,
      lastSnap: snap,
      areaAwaitingOpen: {
        vertices: entity.type === 'polyline' ? entity.geometry.vertices : [],
        sourceId: entity.id,
        message: computation.reason,
      },
      statusMessage:
        'Boundary is open. [C]=Close Temporarily · [B]=Create Boundary · Esc=Cancel',
      preview: null,
    };
  }

  const label =
    entity.type === 'room'
      ? entity.properties.name || 'Room'
      : entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
  const next = applyComputation(
    session,
    bus,
    computation,
    label,
    entity.type,
  );
  // One-shot object measure → Selection Mode (App also calls completeHandoff).
  // Add/Subtract keep AREA active for more picks until Enter finishes the session.
  if (next.areaLastResult && mode === 'object') {
    return {
      ...completeAreaMeasurement(next),
      areaLastResult: next.areaLastResult,
      statusMessage: next.statusMessage,
      preview: next.preview,
      lastSnap: snap,
    };
  }
  return {
    ...next,
    lastSnap: snap,
  };
}

export function handleAreaPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: import('@ratecad/geometry').SnapResult | null,
): ToolSession {
  void input;
  const mode = session.areaMode ?? 'object';
  const doc = bus.getDocument();

  if (mode === 'points' && session.vertices.length > 0) {
    const verts = session.vertices;
    const livePts = [...verts, point];
    const live = previewAreaFromPoints(livePts);
    const u = docUnits(doc);
    return {
      ...session,
      lastSnap: snap,
      preview: {
        kind: 'area',
        start: verts[0]!,
        end: point,
        vertices: livePts,
        areaOuter: livePts.length >= 3 && live.valid ? livePts : undefined,
      },
      statusMessage:
        livePts.length < 3
          ? `AREA · Points: ${verts.length} point(s)`
          : live.valid
            ? `AREA preview · ${formatWorldArea(live.area, u.world, u.display, u.precision)}`
            : 'AREA · self-intersecting preview',
    };
  }

  if (mode === 'pick-inside' || mode === 'room') {
    const computation = findBoundaryAtPoint(doc, point, {
      tolerance: defaultBoundaryTolerance(doc),
    });
    if (!computation.ok) {
      return {
        ...session,
        lastSnap: snap,
        preview: null,
        statusMessage: computation.reason,
      };
    }
    return {
      ...session,
      lastSnap: snap,
      preview: areaPreviewFromResult(computation, point),
      statusMessage: formatResultStatus(computation, doc, 'Hover'),
    };
  }

  return { ...session, lastSnap: snap };
}

/** Finish points polygon (Enter) — closes last→first; does not create geometry. */
export function finishAreaPoints(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  if (session.activeTool !== 'area' || (session.areaMode ?? 'object') !== 'points') {
    return session;
  }
  const computation = areaFromPoints(session.vertices, true);
  const next = applyComputation(session, bus, computation, 'Points', 'polygon');
  return {
    ...completeAreaMeasurement({
      ...next,
      vertices: [],
      anchor: null,
      mode: 'idle',
    }),
    areaLastResult: next.areaLastResult,
    statusMessage: next.statusMessage,
  };
}

/** Undo last picked point. */
export function undoAreaPoint(session: ToolSession): ToolSession {
  if (session.activeTool !== 'area' || (session.areaMode ?? '') !== 'points') {
    return session;
  }
  if (!session.vertices.length) return session;
  const vertices = session.vertices.slice(0, -1);
  return {
    ...session,
    vertices,
    anchor: vertices[vertices.length - 1] ?? null,
    preview: null,
    statusMessage:
      vertices.length === 0
        ? areaModeStatus('points')
        : `AREA · Points: ${vertices.length} point(s) — next or Enter`,
  };
}

/** Undo last add/subtract entry. */
export function undoAreaSessionEntry(session: ToolSession): ToolSession {
  if (!session.areaSession?.entries.length) return session;
  const areaSession = undoAreaEntry(session.areaSession);
  return {
    ...session,
    areaSession,
    areaLastResult: areaSession.entries[areaSession.entries.length - 1]?.result ?? null,
    statusMessage:
      areaSession.entries.length === 0
        ? areaModeStatus(session.areaMode ?? 'add')
        : `AREA session · ${areaSession.entries.length} entries · net ${areaSession.totalArea.toFixed(2)}`,
  };
}

/** Close open polyline temporarily and compute area. */
export function closeAreaTemporarily(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const pending = session.areaAwaitingOpen;
  if (!pending?.sourceId) {
    if (pending && pending.vertices.length >= 3) {
      const computation = areaFromPoints(pending.vertices, true);
      return applyComputation(session, bus, computation, 'Closed temporarily');
    }
    return session;
  }
  const entity = getEntity(bus.getDocument(), pending.sourceId);
  if (!entity) return { ...session, areaAwaitingOpen: null };
  const computation = resolveEntityArea(entity, true);
  const label =
    entity.type === 'room'
      ? entity.properties.name || 'Room'
      : entity.type;
  return applyComputation(session, bus, computation, label);
}

/** Create a closed polyline boundary from the last area result. */
export function createBoundaryFromArea(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const result = session.areaLastResult;
  const pending = session.areaAwaitingOpen;
  let verts: Vec2[] | null = null;
  if (result?.outer?.length) {
    verts = result.outer;
  } else if (pending?.vertices?.length) {
    verts = pending.vertices;
  } else if (pending?.sourceId) {
    const e = getEntity(bus.getDocument(), pending.sourceId);
    if (e?.type === 'polyline') verts = e.geometry.vertices;
  }
  if (!verts || verts.length < 3) {
    return {
      ...session,
      statusMessage: 'No boundary to create',
    };
  }
  bus.execute(new CreatePolylineCommand(verts, undefined, true));
  return {
    ...session,
    areaAwaitingOpen: null,
    statusMessage: 'Created closed polyline boundary',
  };
}

/** Create a text area label at the region centroid (associative via room when available). */
export function createAreaLabel(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const result = session.areaLastResult;
  if (!result) {
    return { ...session, statusMessage: 'No area result to label' };
  }
  const doc = bus.getDocument();
  const u = docUnits(doc);
  const fmt = formatAreaResult(result, u.world, u.display, u.precision);
  const pos = polygonCentroid(result.outer);
  const content = fmt.areaText;
  const height = Math.max(doc.settings.gridSize * 0.35, 0.5);
  bus.execute(new CreateTextCommand(pos, content, height));
  return {
    ...session,
    statusMessage: `Area label created: ${content}`,
  };
}

/** Switch session add/subtract mode without clearing entries. */
export function setAreaSessionOp(
  session: ToolSession,
  op: AreaSessionMode,
): ToolSession {
  const areaSession = setAreaSessionMode(
    session.areaSession ?? createAreaSession(),
    op,
  );
  return {
    ...session,
    areaMode: op === 'add' ? 'add' : 'subtract',
    areaSession,
    statusMessage: areaModeStatus(op === 'add' ? 'add' : 'subtract'),
  };
}

/** Compute area for current selection (object mode shortcut). */
export function areaFromSelection(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const selected = getSelectedEntities(bus.getDocument());
  if (selected.length === 0) {
    return { ...session, statusMessage: 'AREA: nothing selected' };
  }
  if (selected.length === 1) {
    const e = selected[0]!;
    const computation = resolveEntityArea(e);
    if (!computation.ok && computation.code === 'open') {
      return {
        ...session,
        areaAwaitingOpen: {
          vertices: e.type === 'polyline' ? e.geometry.vertices : [],
          sourceId: e.id,
          message: computation.reason,
        },
        statusMessage:
          'Boundary is open. [C]=Close Temporarily · [B]=Create Boundary · Esc=Cancel',
      };
    }
    const label =
      e.type === 'room' ? e.properties.name || 'Room' : e.type;
    return applyComputation(session, bus, computation, label);
  }
  // Multi-select: add each closed entity
  let next = {
    ...session,
    areaMode: 'add' as AreaToolMode,
    areaSession: createAreaSession(),
  };
  for (const e of selected) {
    const computation = resolveEntityArea(e);
    if (!computation.ok) continue;
    const label =
      e.type === 'room' ? e.properties.name || 'Room' : e.type;
    next = applyComputation(next, bus, computation, label) as typeof next;
  }
  return next;
}

export function roomAreaReport(doc: DrawingDocument): {
  rooms: Array<{
    id: EntityId;
    name: string;
    area: number;
    perimeter: number;
  }>;
  totalArea: number;
} {
  const rooms: Array<{
    id: EntityId;
    name: string;
    area: number;
    perimeter: number;
  }> = [];
  let total = 0;
  for (const e of doc.entities) {
    if (e.type !== 'room' || !e.visible) continue;
    const computation = areaFromEntity(e);
    if (!computation.ok) continue;
    rooms.push({
      id: e.id,
      name: e.properties.name || 'Room',
      area: computation.area,
      perimeter: computation.perimeter,
    });
    total += computation.area;
  }
  return { rooms, totalArea: total };
}

export function formatRoomAreaReport(
  doc: DrawingDocument,
): string[] {
  const u = docUnits(doc);
  const report = roomAreaReport(doc);
  const lines = ['ROOM AREA REPORT'];
  for (const r of report.rooms) {
    lines.push(
      `${r.name.padEnd(16)} ${formatWorldArea(r.area, u.world, u.display, u.precision)}`,
    );
  }
  lines.push('────────────────────────────');
  lines.push(
    `TOTAL             ${formatWorldArea(report.totalArea, u.world, u.display, u.precision)}`,
  );
  return lines;
}
