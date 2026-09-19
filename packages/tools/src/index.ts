import type { CommandBus } from '@ratecad/commands';
import {
  CreateCircleCommand,
  CreateLineCommand,
  CreateRectangleCommand,
} from '@ratecad/commands';
import { setSelection, type Vec2 } from '@ratecad/core';
import { distance, snapToGrid } from '@ratecad/geometry';
import {
  hitTestDocument,
  screenToleranceToWorld,
  type Camera,
  type PreviewGeometry,
} from '@ratecad/viewport';

export type ToolId = 'select' | 'line' | 'rectangle' | 'circle' | 'pan';

export interface ToolSession {
  activeTool: ToolId;
  anchor: Vec2 | null;
  preview: PreviewGeometry | null;
  statusMessage: string;
}

export function createToolSession(tool: ToolId = 'select'): ToolSession {
  return {
    activeTool: tool,
    anchor: null,
    preview: null,
    statusMessage: toolStatus(tool),
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
    case 'pan':
      return 'Pan: drag to move the view';
  }
}

function maybeSnap(point: Vec2, bus: CommandBus): Vec2 {
  const doc = bus.getDocument();
  if (!doc.settings.snapToGrid) return point;
  return snapToGrid(point, doc.settings.gridSize);
}

export function setActiveTool(session: ToolSession, tool: ToolId): ToolSession {
  return {
    activeTool: tool,
    anchor: null,
    preview: null,
    statusMessage: toolStatus(tool),
  };
}

export function cancelTool(session: ToolSession): ToolSession {
  return {
    ...session,
    anchor: null,
    preview: null,
    statusMessage: toolStatus(session.activeTool),
  };
}

export interface PointerInput {
  world: Vec2;
  camera: Camera;
  shiftKey?: boolean;
}

export function handleToolPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  const point = maybeSnap(input.world, bus);

  if (session.activeTool === 'select') {
    const tol = screenToleranceToWorld(input.camera, 8);
    const id = hitTestDocument(bus.getDocument(), point, tol);
    bus.updateWithoutHistory((doc) => setSelection(doc, id ? [id] : []));
    return {
      ...session,
      statusMessage: id ? `Selected ${id}` : 'Select: click an object',
    };
  }

  if (session.activeTool === 'pan') {
    return session;
  }

  if (!session.anchor) {
    return {
      ...session,
      anchor: point,
      preview: null,
      statusMessage:
        session.activeTool === 'line'
          ? 'Line: specify second point'
          : session.activeTool === 'rectangle'
            ? 'Rectangle: specify opposite corner'
            : 'Circle: specify radius point',
    };
  }

  // Second click commits geometry via commands
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
    preview: null,
    statusMessage: toolStatus(session.activeTool),
  };
}

export function handleToolPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  if (!session.anchor || session.activeTool === 'select' || session.activeTool === 'pan') {
    return session;
  }

  const point = maybeSnap(input.world, bus);
  const kind =
    session.activeTool === 'line'
      ? 'line'
      : session.activeTool === 'rectangle'
        ? 'rectangle'
        : 'circle';

  return {
    ...session,
    preview: {
      kind,
      start: session.anchor,
      end: point,
    },
  };
}
