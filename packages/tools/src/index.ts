import type { CommandBus } from '@ratecad/commands';
import {
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
} from '@ratecad/commands';
import { setSelection, type Vec2 } from '@ratecad/core';
import { distance, resolveSnap, type SnapResult } from '@ratecad/geometry';
import {
  hitTestDocument,
  screenToleranceToWorld,
  type Camera,
  type PreviewGeometry,
} from '@ratecad/viewport';

export type ToolId =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'polyline'
  | 'pan';

export interface ToolSession {
  activeTool: ToolId;
  /** First point for 2-click tools, or polyline vertices in progress */
  anchor: Vec2 | null;
  vertices: Vec2[];
  preview: PreviewGeometry | null;
  statusMessage: string;
  lastSnap: SnapResult | null;
}

export function createToolSession(tool: ToolId = 'select'): ToolSession {
  return {
    activeTool: tool,
    anchor: null,
    vertices: [],
    preview: null,
    statusMessage: toolStatus(tool),
    lastSnap: null,
  };
}

function toolStatus(tool: ToolId): string {
  switch (tool) {
    case 'select':
      return 'Select: click an object';
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
  }
}

export function setActiveTool(session: ToolSession, tool: ToolId): ToolSession {
  return {
    activeTool: tool,
    anchor: null,
    vertices: [],
    preview: null,
    statusMessage: toolStatus(tool),
    lastSnap: null,
  };
}

export function cancelTool(session: ToolSession): ToolSession {
  return {
    ...session,
    anchor: null,
    vertices: [],
    preview: null,
    statusMessage: toolStatus(session.activeTool),
    lastSnap: null,
  };
}

export interface PointerInput {
  world: Vec2;
  camera: Camera;
  /** Double-click (used to finish polyline) */
  detail?: number;
}

function snapPoint(world: Vec2, bus: CommandBus, camera: Camera): SnapResult {
  const doc = bus.getDocument();
  return resolveSnap(world, doc, {
    enabled: doc.settings.snapToGrid,
    gridSize: doc.settings.gridSize,
    tolerance: screenToleranceToWorld(camera, 10),
  });
}

export function handleToolPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;

  if (session.activeTool === 'select') {
    const tol = screenToleranceToWorld(input.camera, 8);
    const id = hitTestDocument(bus.getDocument(), point, tol);
    bus.updateWithoutHistory((doc) => setSelection(doc, id ? [id] : []));
    return {
      ...session,
      lastSnap: snap,
      statusMessage: id ? `Selected ${id}` : 'Select: click an object',
    };
  }

  if (session.activeTool === 'pan') {
    return { ...session, lastSnap: snap };
  }

  // --- Polyline (multi-click) ---
  if (session.activeTool === 'polyline') {
    const verts = [...session.vertices, point];

    // Double-click finishes when we already have >= 1 vertex (+ this click)
    if ((input.detail ?? 1) >= 2 && session.vertices.length >= 1) {
      const finalVerts =
        session.vertices.length >= 2
          ? session.vertices
          : [...session.vertices, point];
      // Drop duplicate last point often produced by double-click
      const cleaned = [...finalVerts];
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
        ...session,
        anchor: null,
        vertices: [],
        preview: null,
        lastSnap: snap,
        statusMessage: toolStatus('polyline'),
      };
    }

    return {
      ...session,
      anchor: point,
      vertices: verts,
      preview: null,
      lastSnap: snap,
      statusMessage:
        verts.length === 1
          ? 'Polyline: specify next point (double-click to finish)'
          : `Polyline: ${verts.length} points — click next or double-click to finish`,
    };
  }

  // --- Two-click tools ---
  if (!session.anchor) {
    return {
      ...session,
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
    ...session,
    anchor: null,
    vertices: [],
    preview: null,
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

  const kind =
    session.activeTool === 'line'
      ? 'line'
      : session.activeTool === 'rectangle'
        ? 'rectangle'
        : 'circle';

  return {
    ...session,
    lastSnap: snap,
    preview: {
      kind,
      start: session.anchor,
      end: point,
    },
  };
}

/** Finish polyline with Enter / explicit finish (not Escape). */
export function finishPolyline(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  if (session.activeTool !== 'polyline' || session.vertices.length < 2) {
    return cancelTool(session);
  }
  bus.execute(new CreatePolylineCommand(session.vertices));
  return {
    ...session,
    anchor: null,
    vertices: [],
    preview: null,
    lastSnap: null,
    statusMessage: toolStatus('polyline'),
  };
}
