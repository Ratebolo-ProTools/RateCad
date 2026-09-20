import type { CommandBus } from '@ratecad/commands';
import {
  CreateDimensionCommand,
  CreateLeaderCommand,
  CreateTextCommand,
} from '@ratecad/commands';
import {
  getCurrentLayer,
  type DimensionEntity,
  type DimensionKind,
  type LeaderEntity,
  type Vec2,
} from '@ratecad/core';
import {
  distance,
  offsetFromPlacement,
  type SnapResult,
} from '@ratecad/geometry';
import {
  cancelTool,
  toolStatus,
  type ToolSession,
} from './session.js';

function previewDimension(
  kind: DimensionKind,
  start: Vec2,
  end: Vec2,
  offset: number,
  layerId: string,
): DimensionEntity {
  return {
    id: 'preview-dim',
    type: 'dimension',
    layerId,
    visible: true,
    locked: false,
    geometry: { kind, start: { ...start }, end: { ...end }, offset },
    properties: {},
  };
}

function previewLeader(
  arrow: Vec2,
  vertices: Vec2[],
  content: string,
  textHeight: number,
  layerId: string,
): LeaderEntity {
  return {
    id: 'preview-leader',
    type: 'leader',
    layerId,
    visible: true,
    locked: false,
    geometry: {
      arrow: { ...arrow },
      vertices: vertices.map((v) => ({ ...v })),
      content,
      textHeight,
    },
    properties: {},
  };
}

export function handleDimensionPointerDown(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const layerId = getCurrentLayer(bus.getDocument()).id;
  const kind = session.dimKind;

  // Phase 1: first point
  if (session.vertices.length === 0) {
    return {
      ...session,
      mode: 'dimension',
      vertices: [point],
      anchor: point,
      previewEntities: null,
      lastSnap: snap,
      statusMessage: `Dimension (${kind}): specify second point`,
    };
  }

  // Phase 2: second point
  if (session.vertices.length === 1) {
    const start = session.vertices[0]!;
    if (distance(start, point) < 1e-9) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: `Dimension (${kind}): points too close — pick again`,
      };
    }
    return {
      ...session,
      mode: 'dimension',
      vertices: [start, point],
      anchor: point,
      previewEntities: [
        previewDimension(kind, start, point, 1, layerId),
      ],
      lastSnap: snap,
      statusMessage: `Dimension (${kind}): place dimension line`,
    };
  }

  // Phase 3: place offset
  const start = session.vertices[0]!;
  const end = session.vertices[1]!;
  const offset = offsetFromPlacement(start, end, kind, point);
  try {
    bus.execute(new CreateDimensionCommand(kind, start, end, offset, layerId));
  } catch {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: 'Dimension failed: invalid geometry',
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: toolStatus('dimension', kind),
  };
}

export function handleDimensionPointerMove(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const layerId = getCurrentLayer(bus.getDocument()).id;
  const kind = session.dimKind;

  if (session.vertices.length === 1) {
    const start = session.vertices[0]!;
    return {
      ...session,
      lastSnap: snap,
      preview: { kind: 'line', start, end: point },
      previewEntities: null,
    };
  }

  if (session.vertices.length >= 2) {
    const start = session.vertices[0]!;
    const end = session.vertices[1]!;
    const offset = offsetFromPlacement(start, end, kind, point);
    return {
      ...session,
      lastSnap: snap,
      preview: null,
      previewEntities: [previewDimension(kind, start, end, offset, layerId)],
    };
  }

  return { ...session, lastSnap: snap };
}

export function handleTextPointerDown(
  session: ToolSession,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  // Enter text-input mode — App shows a prompt dialog
  return {
    ...session,
    mode: 'text-input',
    anchor: point,
    vertices: [point],
    pendingText: '',
    lastSnap: snap,
    statusMessage: 'Text: enter content',
  };
}

export function commitTextContent(
  session: ToolSession,
  bus: CommandBus,
  content: string,
): ToolSession {
  if (session.activeTool !== 'text' || !session.anchor) {
    return cancelTool(session);
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      ...cancelTool(session),
      statusMessage: 'Text canceled (empty)',
    };
  }
  const doc = bus.getDocument();
  const height = doc.settings.dimensionStyle.textHeight;
  const layerId = getCurrentLayer(doc).id;
  try {
    bus.execute(
      new CreateTextCommand(session.anchor, trimmed, height, 0, layerId),
    );
  } catch {
    return {
      ...cancelTool(session),
      statusMessage: 'Text failed',
    };
  }
  return {
    ...cancelTool(session),
    statusMessage: toolStatus('text'),
  };
}

export function handleLeaderPointerDown(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const layerId = getCurrentLayer(bus.getDocument()).id;
  const height = bus.getDocument().settings.dimensionStyle.textHeight;

  // Phase 1: arrow
  if (session.vertices.length === 0) {
    return {
      ...session,
      mode: 'leader',
      vertices: [point],
      anchor: point,
      lastSnap: snap,
      statusMessage: 'Leader: specify landing point',
    };
  }

  // Phase 2: landing → prompt for text
  if (session.vertices.length === 1) {
    const arrow = session.vertices[0]!;
    if (distance(arrow, point) < 1e-9) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Leader: landing too close — pick again',
      };
    }
    return {
      ...session,
      mode: 'text-input',
      vertices: [arrow, point],
      anchor: point,
      pendingText: '',
      previewEntities: [
        previewLeader(arrow, [point], '…', height, layerId),
      ],
      lastSnap: snap,
      statusMessage: 'Leader: enter callout text',
    };
  }

  return { ...session, lastSnap: snap };
}

export function handleLeaderPointerMove(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  if (session.vertices.length === 1 && session.mode === 'leader') {
    const arrow = session.vertices[0]!;
    const layerId = getCurrentLayer(bus.getDocument()).id;
    const height = bus.getDocument().settings.dimensionStyle.textHeight;
    return {
      ...session,
      lastSnap: snap,
      preview: null,
      previewEntities: [
        previewLeader(arrow, [point], '…', height, layerId),
      ],
    };
  }
  return { ...session, lastSnap: snap };
}

export function commitLeaderContent(
  session: ToolSession,
  bus: CommandBus,
  content: string,
): ToolSession {
  if (session.activeTool !== 'leader' || session.vertices.length < 2) {
    return cancelTool(session);
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      ...cancelTool(session),
      statusMessage: 'Leader canceled (empty)',
    };
  }
  const arrow = session.vertices[0]!;
  const landing = session.vertices[1]!;
  const doc = bus.getDocument();
  const height = doc.settings.dimensionStyle.textHeight;
  const layerId = getCurrentLayer(doc).id;
  try {
    bus.execute(
      new CreateLeaderCommand(arrow, [landing], trimmed, height, layerId),
    );
  } catch {
    return {
      ...cancelTool(session),
      statusMessage: 'Leader failed',
    };
  }
  return {
    ...cancelTool(session),
    statusMessage: toolStatus('leader'),
  };
}
