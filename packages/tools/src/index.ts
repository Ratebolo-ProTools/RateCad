import type { CommandBus } from '@ratecad/commands';
import {
  CopyEntitiesCommand,
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  MoveEntitiesCommand,
  MoveEntityGripCommand,
} from '@ratecad/commands';
import {
  getEntity,
  getSelectedEntities,
  setSelection,
  toggleSelectionId,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  applyGripEdit,
  distance,
  resolveSnap,
  translateEntity,
  vecDelta,
  type SnapResult,
} from '@ratecad/geometry';
import {
  getSelectionGrips,
  hitTestDocument,
  hitTestGrip,
  screenToleranceToWorld,
  selectByRectangle,
  type Camera,
  type Grip,
  type PreviewGeometry,
} from '@ratecad/viewport';

export type ToolId =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'polyline'
  | 'pan'
  | 'move'
  | 'copy';

export type InteractionMode =
  | 'idle'
  | 'draw'
  | 'grip'
  | 'window'
  | 'move'
  | 'copy';

export interface ToolSession {
  activeTool: ToolId;
  mode: InteractionMode;
  anchor: Vec2 | null;
  vertices: Vec2[];
  preview: PreviewGeometry | null;
  previewEntities: Entity[] | null;
  hideEntityIds: EntityId[];
  selectionRect: { a: Vec2; b: Vec2 } | null;
  grip: Grip | null;
  gripEntity: Entity | null;
  statusMessage: string;
  lastSnap: SnapResult | null;
}

export function createToolSession(tool: ToolId = 'select'): ToolSession {
  return {
    activeTool: tool,
    mode: 'idle',
    anchor: null,
    vertices: [],
    preview: null,
    previewEntities: null,
    hideEntityIds: [],
    selectionRect: null,
    grip: null,
    gripEntity: null,
    statusMessage: toolStatus(tool),
    lastSnap: null,
  };
}

function toolStatus(tool: ToolId): string {
  switch (tool) {
    case 'select':
      return 'Select: click object, Ctrl+click multi, drag window';
    case 'line':
      return 'Line: specify first point';
    case 'rectangle':
      return 'Rectangle: specify first corner';
    case 'circle':
      return 'Circle: specify center';
    case 'polyline':
      return 'Polyline: specify first point';
    case 'pan':
      return 'Pan: drag to move the view';
    case 'move':
      return 'Move: select objects, then specify base point';
    case 'copy':
      return 'Copy: select objects, then specify base point';
  }
}

export function setActiveTool(session: ToolSession, tool: ToolId): ToolSession {
  return {
    ...createToolSession(tool),
    activeTool: tool,
    statusMessage: toolStatus(tool),
  };
}

export function cancelTool(session: ToolSession): ToolSession {
  return {
    ...createToolSession(session.activeTool),
    activeTool: session.activeTool,
    statusMessage: toolStatus(session.activeTool),
  };
}

export interface PointerInput {
  world: Vec2;
  camera: Camera;
  detail?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

function snapPoint(world: Vec2, bus: CommandBus, camera: Camera): SnapResult {
  const doc = bus.getDocument();
  return resolveSnap(world, doc, {
    enabled: doc.settings.snapToGrid,
    gridSize: doc.settings.gridSize,
    tolerance: screenToleranceToWorld(camera, 10),
  });
}

function selectedOrMessage(bus: CommandBus): Entity[] {
  return getSelectedEntities(bus.getDocument());
}

export function handleToolPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;
  const multi = !!(input.ctrlKey || input.metaKey);

  // --- Select / grip / window ---
  if (session.activeTool === 'select') {
    // Continue window drag
    if (session.mode === 'window' && session.anchor) {
      return session;
    }

    // Hit grip first (single-select editing)
    const selected = selectedOrMessage(bus);
    if (selected.length > 0 && !multi) {
      const grips = getSelectionGrips(selected);
      const gripTol = screenToleranceToWorld(input.camera, 8);
      const grip = hitTestGrip(grips, point, gripTol);
      if (grip) {
        const entity = getEntity(bus.getDocument(), grip.entityId);
        if (entity) {
          return {
            ...session,
            mode: 'grip',
            grip,
            gripEntity: structuredClone(entity),
            anchor: point,
            previewEntities: [entity],
            hideEntityIds: [entity.id],
            lastSnap: snap,
            statusMessage: `Grip: drag ${grip.role}`,
          };
        }
      }
    }

    const tol = screenToleranceToWorld(input.camera, 8);
    const id = hitTestDocument(bus.getDocument(), point, tol);
    if (id) {
      if (multi) {
        bus.updateWithoutHistory((doc) => toggleSelectionId(doc, id));
      } else {
        bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
      }
      const count = bus.getDocument().selection.length;
      return {
        ...session,
        mode: 'idle',
        lastSnap: snap,
        statusMessage:
          count > 1 ? `${count} objects selected` : `Selected ${id}`,
      };
    }

    // Start window selection
    if (!multi) {
      bus.updateWithoutHistory((doc) => setSelection(doc, []));
    }
    return {
      ...session,
      mode: 'window',
      anchor: point,
      selectionRect: { a: point, b: point },
      lastSnap: snap,
      statusMessage: 'Window select: drag rectangle',
    };
  }

  if (session.activeTool === 'pan') {
    return { ...session, lastSnap: snap };
  }

  // --- Move ---
  if (session.activeTool === 'move') {
    const selected = selectedOrMessage(bus);
    if (selected.length === 0) {
      // Allow pick-to-select then move
      const tol = screenToleranceToWorld(input.camera, 8);
      const id = hitTestDocument(bus.getDocument(), point, tol);
      if (id) {
        bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
        return {
          ...session,
          mode: 'idle',
          lastSnap: snap,
          statusMessage: 'Move: specify base point',
        };
      }
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Move: select object(s) first',
      };
    }

    if (!session.anchor) {
      return {
        ...session,
        mode: 'move',
        anchor: point,
        previewEntities: selected.map((e) => structuredClone(e)),
        hideEntityIds: selected.map((e) => e.id),
        lastSnap: snap,
        statusMessage: 'Move: specify destination',
      };
    }

    const delta = vecDelta(session.anchor, point);
    try {
      bus.execute(new MoveEntitiesCommand(selected, delta));
    } catch {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Move failed: invalid geometry',
      };
    }
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Moved ${selected.length} object(s)`,
    };
  }

  // --- Copy ---
  if (session.activeTool === 'copy') {
    const selected = selectedOrMessage(bus);
    if (selected.length === 0) {
      const tol = screenToleranceToWorld(input.camera, 8);
      const id = hitTestDocument(bus.getDocument(), point, tol);
      if (id) {
        bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
        return {
          ...session,
          mode: 'idle',
          lastSnap: snap,
          statusMessage: 'Copy: specify base point',
        };
      }
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Copy: select object(s) first',
      };
    }

    if (!session.anchor) {
      return {
        ...session,
        mode: 'copy',
        anchor: point,
        previewEntities: selected.map((e) => structuredClone(e)),
        hideEntityIds: [],
        lastSnap: snap,
        statusMessage: 'Copy: specify destination (Esc to finish)',
      };
    }

    const delta = vecDelta(session.anchor, point);
    try {
      const cmd = new CopyEntitiesCommand(selected, delta);
      bus.execute(cmd);
      // Keep same base point for optional repeated placement
      return {
        ...session,
        mode: 'copy',
        anchor: session.anchor,
        previewEntities: selected.map((e) => structuredClone(e)),
        hideEntityIds: [],
        lastSnap: snap,
        statusMessage: `Copied ${selected.length} — click next destination or Esc`,
      };
    } catch {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Copy failed: invalid geometry',
      };
    }
  }

  // --- Polyline ---
  if (session.activeTool === 'polyline') {
    const verts = [...session.vertices, point];
    if ((input.detail ?? 1) >= 2 && session.vertices.length >= 1) {
      const cleaned = [...(session.vertices.length >= 2 ? session.vertices : verts)];
      if (
        cleaned.length >= 2 &&
        distance(cleaned[cleaned.length - 1]!, cleaned[cleaned.length - 2]!) < 1e-9
      ) {
        cleaned.pop();
      }
      if (cleaned.length >= 2) {
        bus.execute(new CreatePolylineCommand(cleaned));
      }
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: toolStatus('polyline'),
      };
    }
    return {
      ...session,
      mode: 'draw',
      anchor: point,
      vertices: verts,
      preview: null,
      lastSnap: snap,
      statusMessage:
        verts.length === 1
          ? 'Polyline: specify next point (double-click/Enter to finish)'
          : `Polyline: ${verts.length} points — next or Enter`,
    };
  }

  // --- Two-click draw tools ---
  if (!session.anchor) {
    return {
      ...session,
      mode: 'draw',
      anchor: point,
      vertices: [],
      preview: null,
      lastSnap: snap,
      statusMessage:
        session.activeTool === 'line'
          ? 'Line: specify second point'
          : session.activeTool === 'rectangle'
            ? 'Rectangle: specify opposite corner'
            : 'Circle: specify radius point',
    };
  }

  switch (session.activeTool) {
    case 'line':
      if (distance(session.anchor, point) > 1e-9) {
        bus.execute(new CreateLineCommand(session.anchor, point));
      }
      break;
    case 'rectangle':
      if (distance(session.anchor, point) > 1e-9) {
        bus.execute(new CreateRectangleCommand(session.anchor, point));
      }
      break;
    case 'circle': {
      const radius = distance(session.anchor, point);
      if (radius > 1e-9) {
        bus.execute(new CreateCircleCommand(session.anchor, radius));
      }
      break;
    }
  }

  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: toolStatus(session.activeTool),
  };
}

export function handleToolPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;

  if (session.mode === 'grip' && session.grip && session.gripEntity) {
    const preview = applyGripEdit(
      session.gripEntity,
      session.grip.editTarget,
      point,
    );
    return {
      ...session,
      lastSnap: snap,
      previewEntities: preview ? [preview] : [session.gripEntity],
      hideEntityIds: [session.gripEntity.id],
    };
  }

  if (session.mode === 'window' && session.anchor) {
    return {
      ...session,
      lastSnap: snap,
      selectionRect: { a: session.anchor, b: point },
      statusMessage:
        point.x >= session.anchor.x
          ? 'Window select (inside)'
          : 'Crossing select (touching)',
    };
  }

  if (
    (session.mode === 'move' || session.mode === 'copy') &&
    session.anchor
  ) {
    const selected = selectedOrMessage(bus);
    const delta = vecDelta(session.anchor, point);
    const previewEntities = selected
      .map((e) => translateEntity(e, delta))
      .filter((e): e is Entity => !!e);
    return {
      ...session,
      lastSnap: snap,
      previewEntities,
      hideEntityIds: session.mode === 'move' ? selected.map((e) => e.id) : [],
    };
  }

  if (session.activeTool === 'select' || session.activeTool === 'pan') {
    return { ...session, lastSnap: snap };
  }

  if (session.activeTool === 'polyline') {
    if (session.vertices.length === 0) {
      return { ...session, lastSnap: snap, preview: null };
    }
    const last = session.vertices[session.vertices.length - 1]!;
    return {
      ...session,
      lastSnap: snap,
      preview: {
        kind: 'polyline',
        start: last,
        end: point,
        vertices: session.vertices,
      },
    };
  }

  if (!session.anchor) {
    return { ...session, lastSnap: snap, preview: null };
  }

  if (
    session.activeTool === 'line' ||
    session.activeTool === 'rectangle' ||
    session.activeTool === 'circle'
  ) {
    return {
      ...session,
      lastSnap: snap,
      preview: {
        kind: session.activeTool === 'line' ? 'line' : session.activeTool,
        start: session.anchor,
        end: point,
      },
    };
  }

  return { ...session, lastSnap: snap };
}

export function handleToolPointerUp(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;

  // Commit grip edit
  if (session.mode === 'grip' && session.grip && session.gripEntity) {
    try {
      bus.execute(
        new MoveEntityGripCommand(
          session.gripEntity,
          session.grip.editTarget,
          point,
        ),
      );
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Grip edit committed',
      };
    } catch {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Grip edit canceled (invalid)',
      };
    }
  }

  // Commit window selection
  if (session.mode === 'window' && session.anchor) {
    const ids = selectByRectangle(bus.getDocument(), session.anchor, point, 'auto');
    const multi = !!(input.ctrlKey || input.metaKey);
    if (multi) {
      bus.updateWithoutHistory((doc) => {
        const set = new Set(doc.selection);
        for (const id of ids) set.add(id);
        return setSelection(doc, [...set]);
      });
    } else {
      bus.updateWithoutHistory((doc) => setSelection(doc, ids));
    }
    const count = bus.getDocument().selection.length;
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage:
        count === 0
          ? 'Select: click object, Ctrl+click multi, drag window'
          : count === 1
            ? `Selected ${bus.getDocument().selection[0]}`
            : `${count} objects selected`,
    };
  }

  return session;
}

export function finishPolyline(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  if (session.activeTool !== 'polyline' || session.vertices.length < 2) {
    return cancelTool(session);
  }
  bus.execute(new CreatePolylineCommand(session.vertices));
  return {
    ...cancelTool(session),
    statusMessage: toolStatus('polyline'),
  };
}
