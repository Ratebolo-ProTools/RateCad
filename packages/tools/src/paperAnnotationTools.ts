/**
 * Paper Space annotation tools — create text / dimensions / leaders
 * on layout.paperSpaceEntities (never Model Space).
 */

import type { CommandBus } from '@ratecad/commands';
import {
  CreatePaperDimensionCommand,
  CreatePaperLeaderCommand,
  CreatePaperTextCommand,
} from '@ratecad/commands';
import {
  PAPER_ANNOTATION_DEFAULTS,
  TEXT_LAYER_ID,
  DIMENSIONS_LAYER_ID,
  ANNOTATIONS_LAYER_ID,
  type DimensionKind,
  type LayoutId,
  type Vec2,
} from '@ratecad/core';
import { distance, offsetFromPlacement } from '@ratecad/geometry';
import {
  cancelTool,
  type ToolSession,
} from './session.js';

export function handlePaperDimensionPointerDown(
  session: ToolSession,
  bus: CommandBus,
  layoutId: LayoutId,
  point: Vec2,
): ToolSession {
  const kind = session.dimKind;
  if (session.vertices.length === 0) {
    return {
      ...session,
      mode: 'dimension',
      vertices: [point],
      statusMessage: `PAPER DIM (${kind}): Specify second point`,
    };
  }
  if (session.vertices.length === 1) {
    const start = session.vertices[0]!;
    if (kind === 'horizontal' || kind === 'vertical' || kind === 'aligned') {
      return {
        ...session,
        mode: 'dimension',
        vertices: [start, point],
        statusMessage: 'PAPER DIM: Specify dimension line location',
      };
    }
  }
  if (session.vertices.length === 2) {
    const start = session.vertices[0]!;
    const end = session.vertices[1]!;
    const offset = offsetFromPlacement(start, end, kind, point);
    bus.execute(
      new CreatePaperDimensionCommand(
        layoutId,
        kind,
        start,
        end,
        offset,
        DIMENSIONS_LAYER_ID,
      ),
    );
    return {
      ...cancelTool(session),
      statusMessage: 'Paper dimension created',
    };
  }
  return session;
}

export function handlePaperDimensionPointerMove(
  session: ToolSession,
  point: Vec2,
): ToolSession {
  if (session.mode !== 'dimension') return session;
  if (session.vertices.length === 1) {
    return {
      ...session,
      previewEntities: null,
      statusMessage: `PAPER DIM: ${distance(session.vertices[0]!, point).toFixed(1)}`,
    };
  }
  return session;
}

export function handlePaperTextPointerDown(
  session: ToolSession,
  point: Vec2,
): ToolSession {
  return {
    ...session,
    mode: 'text-input',
    anchor: point,
    statusMessage: 'PAPER TEXT: Enter content',
  };
}

export function commitPaperTextContent(
  session: ToolSession,
  bus: CommandBus,
  layoutId: LayoutId,
  content: string,
): ToolSession {
  if (!session.anchor || !content.trim()) {
    return { ...cancelTool(session), statusMessage: 'Paper text cancelled' };
  }
  bus.execute(
    new CreatePaperTextCommand(
      layoutId,
      session.anchor,
      content.trim(),
      PAPER_ANNOTATION_DEFAULTS.textHeight,
      0,
      TEXT_LAYER_ID,
      'left',
    ),
  );
  return {
    ...cancelTool(session),
    statusMessage: 'Paper text created',
  };
}

export function handlePaperLeaderPointerDown(
  session: ToolSession,
  point: Vec2,
): ToolSession {
  if (session.vertices.length === 0) {
    return {
      ...session,
      mode: 'leader',
      vertices: [point],
      statusMessage: 'PAPER LEADER: Specify next point',
    };
  }
  return {
    ...session,
    mode: 'text-input',
    vertices: [...session.vertices, point],
    anchor: point,
    statusMessage: 'PAPER LEADER: Enter text',
  };
}

export function commitPaperLeaderContent(
  session: ToolSession,
  bus: CommandBus,
  layoutId: LayoutId,
  content: string,
): ToolSession {
  if (session.vertices.length < 2 || !content.trim()) {
    return { ...cancelTool(session), statusMessage: 'Paper leader cancelled' };
  }
  const arrow = session.vertices[0]!;
  const rest = session.vertices.slice(1);
  bus.execute(
    new CreatePaperLeaderCommand(
      layoutId,
      arrow,
      rest,
      content.trim(),
      PAPER_ANNOTATION_DEFAULTS.leaderTextHeight,
      ANNOTATIONS_LAYER_ID,
    ),
  );
  return {
    ...cancelTool(session),
    statusMessage: 'Paper leader created',
  };
}

export type PaperAnnotationTool = 'text' | 'dimension' | 'leader' | 'line';

export function isPaperAnnotationTool(tool: string): tool is PaperAnnotationTool {
  return (
    tool === 'text' ||
    tool === 'dimension' ||
    tool === 'leader' ||
    tool === 'line'
  );
}

void isPaperAnnotationTool;
void handlePaperDimensionPointerMove;
