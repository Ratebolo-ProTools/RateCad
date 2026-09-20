import type { CommandBus } from '@ratecad/commands';
import {
  ExtendEntityCommand,
  MirrorEntitiesCommand,
  OffsetEntityCommand,
  RotateEntitiesCommand,
  ScaleEntitiesCommand,
  TrimEntityCommand,
} from '@ratecad/commands';
import {
  createEntityId,
  getEntity,
  getSelectedEntities,
  isEntityModifiable,
  setSelection,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  angleBetween,
  distance,
  extendEntity,
  formatLength,
  mirrorEntity,
  offsetEntity,
  parseAngleDegrees,
  parsePositiveScale,
  rotateEntity,
  scaleEntity,
  trimEntity,
  trimRemovalPreview,
} from '@ratecad/geometry';
import { hitTestDocument, screenToleranceToWorld } from '@ratecad/viewport';
import {
  cancelTool,
  type PointerInput,
  type ToolSession,
} from './session.js';

function selected(bus: CommandBus): Entity[] {
  return getSelectedEntities(bus.getDocument());
}

function modifiableSelected(bus: CommandBus): Entity[] {
  const doc = bus.getDocument();
  return getSelectedEntities(doc).filter((e) => isEntityModifiable(doc, e));
}

function pickEntity(
  bus: CommandBus,
  point: Vec2,
  camera: PointerInput['camera'],
  exclude?: EntityId,
): Entity | null {
  const tol = screenToleranceToWorld(camera, 14);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id || id === exclude) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function assertModifiable(
  bus: CommandBus,
  entity: Entity,
  snap: ToolSession['lastSnap'],
  session: ToolSession,
  action: string,
): ToolSession | null {
  if (isEntityModifiable(bus.getDocument(), entity)) return null;
  return {
    ...session,
    lastSnap: snap,
    statusMessage: `Locked layer — cannot ${action}`,
  };
}

export function handleTrimPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  // Hit-test with raw cursor so grid snap does not miss thin entities
  const pickAt = input.world;

  if (!session.refEntityId) {
    const ent = pickEntity(bus, pickAt, input.camera);
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Trim: select cutting edge',
      };
    }
    bus.updateWithoutHistory((doc) => setSelection(doc, [ent.id]));
    return {
      ...session,
      mode: 'trim',
      refEntityId: ent.id,
      lastSnap: snap,
      statusMessage: 'Trim: select object portion to remove',
    };
  }

  const cutter = getEntity(bus.getDocument(), session.refEntityId);
  if (!cutter) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: 'Trim: cutting edge lost',
    };
  }
  const target = pickEntity(bus, pickAt, input.camera, cutter.id);
  if (!target) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Trim: select object to trim',
    };
  }
  const locked = assertModifiable(bus, target, snap, session, 'trim');
  if (locked) return locked;

  // Use snapped point for geometry when near intersections; else raw pick
  const pickPoint = snapPoint;

  const preview = trimEntity(target, cutter, pickPoint);
  if (!preview.ok) {
    // Retry with raw pick projection onto target if snap drifted
    const retry = trimEntity(target, cutter, pickAt);
    if (!retry.ok) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: `Trim: ${preview.reason}`,
      };
    }
    try {
      bus.execute(new TrimEntityCommand(target, cutter, pickAt));
    } catch (err) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: `Trim failed: ${err instanceof Error ? err.message : 'error'}`,
      };
    }
  } else {
    try {
      bus.execute(new TrimEntityCommand(target, cutter, pickPoint));
    } catch (err) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: `Trim failed: ${err instanceof Error ? err.message : 'error'}`,
      };
    }
  }

  return {
    ...session,
    mode: 'trim',
    refEntityId: cutter.id,
    previewEntities: null,
    hideEntityIds: [],
    lastSnap: snap,
    statusMessage: 'Trim: select next portion (Esc to finish)',
  };
}

export function handleTrimPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.refEntityId) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: null,
      hideEntityIds: [],
    };
  }
  const cutter = getEntity(bus.getDocument(), session.refEntityId);
  if (!cutter) return { ...session, lastSnap: snap };
  const target = pickEntity(bus, input.world, input.camera, cutter.id);
  if (!target) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: null,
      hideEntityIds: [],
    };
  }
  const pickPoint = snapPoint;
  let result = trimEntity(target, cutter, pickPoint);
  if (!result.ok) result = trimEntity(target, cutter, input.world);
  const removal =
    trimRemovalPreview(target, cutter, pickPoint) ??
    trimRemovalPreview(target, cutter, input.world);
  if (!result.ok) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: removal ? [removal] : null,
      hideEntityIds: [],
      statusMessage: `Trim: ${result.reason}`,
    };
  }
  return {
    ...session,
    lastSnap: snap,
    previewEntities: [
      ...(removal ? [removal] : []),
      ...result.entities.map((e) => ({
        ...e,
        properties: { ...e.properties, color: '#7eb6ff' },
      })),
    ],
    hideEntityIds: [target.id],
    statusMessage: 'Trim: click to commit',
  };
}

export function handleExtendPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  const pickAt = input.world;
  if (!session.refEntityId) {
    const ent = pickEntity(bus, pickAt, input.camera);
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Extend: select boundary edge',
      };
    }
    bus.updateWithoutHistory((doc) => setSelection(doc, [ent.id]));
    return {
      ...session,
      mode: 'extend',
      refEntityId: ent.id,
      lastSnap: snap,
      statusMessage: 'Extend: select object to extend (near end)',
    };
  }

  const boundary = getEntity(bus.getDocument(), session.refEntityId);
  if (!boundary) {
    return { ...cancelTool(session), lastSnap: snap };
  }
  const target = pickEntity(bus, pickAt, input.camera, boundary.id);
  if (!target) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Extend: select object to extend',
    };
  }
  const locked = assertModifiable(bus, target, snap, session, 'extend');
  if (locked) return locked;

  try {
    bus.execute(new ExtendEntityCommand(target, boundary, pickAt));
  } catch (err) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: `Extend failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }

  return {
    ...session,
    mode: 'extend',
    refEntityId: boundary.id,
    previewEntities: null,
    hideEntityIds: [],
    lastSnap: snap,
    statusMessage: 'Extend: select next object (Esc to finish)',
  };
}

export function handleExtendPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.refEntityId) {
    return { ...session, lastSnap: snap, previewEntities: null };
  }
  const boundary = getEntity(bus.getDocument(), session.refEntityId);
  if (!boundary) return { ...session, lastSnap: snap };
  const target = pickEntity(bus, input.world, input.camera, boundary.id);
  if (!target) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: null,
      hideEntityIds: [],
    };
  }
  void snapPoint;
  const result = extendEntity(target, boundary, input.world);
  if (!result.ok) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: null,
      hideEntityIds: [],
      statusMessage: `Extend: ${result.reason}`,
    };
  }
  return {
    ...session,
    lastSnap: snap,
    previewEntities: result.entities.map((e) => ({
      ...e,
      properties: { ...e.properties, color: '#7eb6ff' },
    })),
    hideEntityIds: [target.id],
    statusMessage: 'Extend: click to commit',
  };
}

function estimateOffsetDistance(source: Entity, snapPoint: Vec2): number {
  if (source.type === 'line') {
    const mid = {
      x: (source.geometry.start.x + source.geometry.end.x) / 2,
      y: (source.geometry.start.y + source.geometry.end.y) / 2,
    };
    return distance(mid, snapPoint);
  }
  if (source.type === 'polyline' && source.geometry.vertices[0]) {
    return distance(source.geometry.vertices[0], snapPoint);
  }
  if (source.type === 'rectangle') {
    return distance(source.geometry.corner1, snapPoint);
  }
  if (source.type === 'circle') {
    return Math.abs(
      distance(source.geometry.center, snapPoint) - source.geometry.radius,
    );
  }
  return 1;
}

export function handleOffsetPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  const sel = selected(bus);

  if (!session.refEntityId) {
    let ent = sel.length === 1 ? sel[0]! : null;
    if (!ent) {
      ent = pickEntity(bus, snapPoint, input.camera);
      if (ent) bus.updateWithoutHistory((doc) => setSelection(doc, [ent!.id]));
    }
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Offset: select object',
      };
    }
    return {
      ...session,
      mode: 'offset',
      refEntityId: ent.id,
      anchor: null,
      numericValue: null,
      inputBuffer: '',
      lastSnap: snap,
      statusMessage: 'Offset: specify distance (type value+Enter or click)',
    };
  }

  const source = getEntity(bus.getDocument(), session.refEntityId);
  if (!source) return { ...cancelTool(session), lastSnap: snap };
  const locked = assertModifiable(bus, source, snap, session, 'offset');
  if (locked) return locked;

  const dist =
    session.numericValue != null
      ? session.numericValue
      : estimateOffsetDistance(source, snapPoint);

  if (!(dist > 1e-9)) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Offset: distance too small',
    };
  }

  try {
    bus.execute(new OffsetEntityCommand(source, dist, snapPoint));
  } catch (err) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: `Offset failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: `Offset created (d=${formatLength(dist)})`,
  };
}

export function handleOffsetPointerMove(
  session: ToolSession,
  bus: CommandBus,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.refEntityId) return { ...session, lastSnap: snap };
  const source = getEntity(bus.getDocument(), session.refEntityId);
  if (!source) return { ...session, lastSnap: snap };

  const dist =
    session.numericValue != null
      ? session.numericValue
      : estimateOffsetDistance(source, snapPoint);
  if (!(dist > 1e-9)) {
    return { ...session, lastSnap: snap, previewEntities: null };
  }
  const result = offsetEntity(source, dist, snapPoint, createEntityId('preview'));
  if (!result.ok) {
    return {
      ...session,
      lastSnap: snap,
      previewEntities: null,
      statusMessage: `Offset: ${result.reason}`,
    };
  }
  return {
    ...session,
    lastSnap: snap,
    previewEntities: result.entities,
    hideEntityIds: [],
    statusMessage:
      session.numericValue != null
        ? `Offset: choose side (d=${formatLength(session.numericValue)})`
        : `Offset: d≈${formatLength(dist)} — click to commit`,
  };
}

export function commitOffsetDistance(
  session: ToolSession,
  buffer: string,
): ToolSession {
  const n = Number(buffer.trim());
  if (!Number.isFinite(n) || !(Math.abs(n) > 0)) {
    return {
      ...session,
      statusMessage: 'Offset: invalid distance',
      inputBuffer: '',
    };
  }
  return {
    ...session,
    numericValue: Math.abs(n),
    inputBuffer: '',
    statusMessage: `Offset: choose side (d=${formatLength(Math.abs(n))})`,
  };
}

export function handleMirrorPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  let sel = modifiableSelected(bus);
  if (sel.length === 0) {
    const ent = pickEntity(bus, snapPoint, input.camera);
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Mirror: select object(s) first',
      };
    }
    if (!isEntityModifiable(bus.getDocument(), ent)) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Locked layer — cannot mirror',
      };
    }
    bus.updateWithoutHistory((doc) => setSelection(doc, [ent.id]));
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Mirror: specify first point of mirror axis',
    };
  }

  if (!session.anchor) {
    return {
      ...session,
      mode: 'mirror',
      anchor: snapPoint,
      lastSnap: snap,
      statusMessage: 'Mirror: specify second point of mirror axis',
    };
  }

  try {
    bus.execute(new MirrorEntitiesCommand(sel, session.anchor, snapPoint, true));
  } catch (err) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Mirror failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: `Mirrored ${sel.length} object(s)`,
  };
}

export function handleMirrorPointerMove(
  session: ToolSession,
  bus: CommandBus,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.anchor) return { ...session, lastSnap: snap };
  const sel = selected(bus);
  const previews: Entity[] = [];
  for (const e of sel) {
    const m = mirrorEntity(e, session.anchor, snapPoint, createEntityId('preview'));
    if (m) previews.push(m);
  }
  return {
    ...session,
    lastSnap: snap,
    previewEntities: previews,
    hideEntityIds: [],
    preview: {
      kind: 'line',
      start: session.anchor,
      end: snapPoint,
    },
  };
}

export function handleRotatePointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  const sel = modifiableSelected(bus);
  if (sel.length === 0) {
    const ent = pickEntity(bus, snapPoint, input.camera);
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Rotate: select object(s) first',
      };
    }
    if (!isEntityModifiable(bus.getDocument(), ent)) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Locked layer — cannot rotate',
      };
    }
    bus.updateWithoutHistory((doc) => setSelection(doc, [ent.id]));
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Rotate: specify base point',
    };
  }

  if (!session.anchor) {
    return {
      ...session,
      mode: 'rotate',
      anchor: snapPoint,
      referenceAngle: null,
      numericValue: null,
      inputBuffer: '',
      lastSnap: snap,
      statusMessage:
        'Rotate: specify angle (type deg+Enter or click reference then angle)',
    };
  }

  if (session.referenceAngle == null && session.numericValue == null) {
    return {
      ...session,
      referenceAngle: angleBetween(session.anchor, snapPoint),
      lastSnap: snap,
      statusMessage:
        'Rotate: specify second angle point (or type degrees+Enter)',
    };
  }

  const radians =
    session.numericValue != null
      ? session.numericValue
      : angleBetween(session.anchor, snapPoint) - (session.referenceAngle ?? 0);

  try {
    bus.execute(new RotateEntitiesCommand(sel, session.anchor, radians));
  } catch (err) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Rotate failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: `Rotated ${sel.length} object(s)`,
  };
}

export function handleRotatePointerMove(
  session: ToolSession,
  bus: CommandBus,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.anchor) return { ...session, lastSnap: snap };
  const sel = selected(bus);
  let radians = session.numericValue;
  if (radians == null) {
    if (session.referenceAngle == null) {
      return {
        ...session,
        lastSnap: snap,
        preview: { kind: 'line', start: session.anchor, end: snapPoint },
      };
    }
    radians = angleBetween(session.anchor, snapPoint) - session.referenceAngle;
  }
  const previews = sel
    .map((e) => rotateEntity(e, session.anchor!, radians!))
    .filter((e): e is Entity => !!e);
  return {
    ...session,
    lastSnap: snap,
    previewEntities: previews,
    hideEntityIds: sel.map((e) => e.id),
    preview: { kind: 'line', start: session.anchor, end: snapPoint },
  };
}

export function commitRotateAngle(
  session: ToolSession,
  buffer: string,
): ToolSession {
  const rad = parseAngleDegrees(buffer);
  if (rad == null) {
    return {
      ...session,
      statusMessage: 'Rotate: invalid angle',
      inputBuffer: '',
    };
  }
  return {
    ...session,
    numericValue: rad,
    inputBuffer: '',
    statusMessage: `Rotate: click to confirm (${buffer.trim()}°)`,
  };
}

export function handleScalePointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  const sel = modifiableSelected(bus);
  if (sel.length === 0) {
    const ent = pickEntity(bus, snapPoint, input.camera);
    if (!ent) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Scale: select object(s) first',
      };
    }
    if (!isEntityModifiable(bus.getDocument(), ent)) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Locked layer — cannot scale',
      };
    }
    bus.updateWithoutHistory((doc) => setSelection(doc, [ent.id]));
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Scale: specify base point',
    };
  }

  if (!session.anchor) {
    return {
      ...session,
      mode: 'scale',
      anchor: snapPoint,
      numericValue: null,
      inputBuffer: '',
      scaleRefLength: null,
      lastSnap: snap,
      statusMessage:
        'Scale: enter factor (e.g. 2) + Enter, or click reference length',
    };
  }

  if (session.numericValue == null) {
    if (session.scaleRefLength == null) {
      const len = distance(session.anchor, snapPoint);
      if (!(len > 1e-9)) {
        return {
          ...session,
          lastSnap: snap,
          statusMessage: 'Scale: pick a farther reference point',
        };
      }
      return {
        ...session,
        scaleRefLength: len,
        lastSnap: snap,
        statusMessage:
          'Scale: pick second point for new length (or type factor+Enter)',
      };
    }
    const newLen = distance(session.anchor, snapPoint);
    const factor = newLen / session.scaleRefLength;
    if (!(factor > 0) || !Number.isFinite(factor)) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Scale: invalid factor',
      };
    }
    try {
      bus.execute(new ScaleEntitiesCommand(sel, session.anchor, factor));
    } catch (err) {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: `Scale failed: ${err instanceof Error ? err.message : 'error'}`,
      };
    }
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Scaled ${sel.length} object(s) ×${factor.toFixed(3)}`,
    };
  }

  try {
    bus.execute(
      new ScaleEntitiesCommand(sel, session.anchor, session.numericValue),
    );
  } catch (err) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Scale failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: `Scaled ${sel.length} object(s) ×${session.numericValue}`,
  };
}

export function handleScalePointerMove(
  session: ToolSession,
  bus: CommandBus,
  snapPoint: Vec2,
  snap: ToolSession['lastSnap'],
): ToolSession {
  if (!session.anchor) return { ...session, lastSnap: snap };
  const sel = selected(bus);
  let factor = session.numericValue;
  if (factor == null && session.scaleRefLength != null) {
    const newLen = distance(session.anchor, snapPoint);
    factor = newLen / session.scaleRefLength;
  }
  if (factor == null || !(factor > 0)) {
    return {
      ...session,
      lastSnap: snap,
      preview: { kind: 'line', start: session.anchor, end: snapPoint },
    };
  }
  const previews = sel
    .map((e) => scaleEntity(e, session.anchor!, factor!))
    .filter((e): e is Entity => !!e);
  return {
    ...session,
    lastSnap: snap,
    previewEntities: previews,
    hideEntityIds: sel.map((e) => e.id),
    preview: { kind: 'line', start: session.anchor, end: snapPoint },
  };
}

export function commitScaleFactor(
  session: ToolSession,
  buffer: string,
): ToolSession {
  const f = parsePositiveScale(buffer);
  if (f == null) {
    return {
      ...session,
      statusMessage: 'Scale: invalid factor',
      inputBuffer: '',
    };
  }
  return {
    ...session,
    numericValue: f,
    inputBuffer: '',
    statusMessage: `Scale: click to confirm (×${f})`,
  };
}
