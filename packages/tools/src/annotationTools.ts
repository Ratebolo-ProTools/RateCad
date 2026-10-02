import type { CommandBus } from '@ratecad/commands';
import {
  CreateDimensionCommand,
  CreateLeaderCommand,
  CreateTextCommand,
} from '@ratecad/commands';
import {
  annotativeDimensionCreate,
  annotativeLeaderCreate,
  annotativeTextCreate,
  getCurrentLayer,
  resolveAnnotationSettings,
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

function modelAnnotationOpts(bus: CommandBus) {
  const doc = bus.getDocument();
  const ann = resolveAnnotationSettings(doc.settings.annotationScale);
  if (!ann.annotativeByDefault) {
    return {
      annotative: false as const,
      textHeight: doc.settings.dimensionStyle.textHeight,
      dimTextHeight: doc.settings.dimensionStyle.textHeight,
      arrowSize: doc.settings.dimensionStyle.arrowSize,
      ann,
    };
  }
  return { annotative: true as const, ann };
}

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
  const needThree = kind === 'angular';

  // Phase 1: first point
  if (session.vertices.length === 0) {
    return {
      ...session,
      mode: 'dimension',
      vertices: [point],
      anchor: point,
      previewEntities: null,
      lastSnap: snap,
      statusMessage: needThree
        ? `Dimension (angular): specify first ray point`
        : kind === 'radius' || kind === 'diameter'
          ? `Dimension (${kind}): specify rim point`
          : `Dimension (${kind}): specify second point`,
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
    if (needThree) {
      return {
        ...session,
        mode: 'dimension',
        vertices: [start, point],
        anchor: point,
        lastSnap: snap,
        statusMessage: `Dimension (angular): specify second ray point`,
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

  // Angular: third ray point
  if (needThree && session.vertices.length === 2) {
    const vertex = session.vertices[0]!;
    const rayA = session.vertices[1]!;
    if (distance(vertex, point) < 1e-9) {
      return {
        ...session,
        lastSnap: snap,
        statusMessage: 'Dimension (angular): points too close — pick again',
      };
    }
    return {
      ...session,
      mode: 'dimension',
      vertices: [vertex, rayA, point],
      anchor: point,
      previewEntities: [
        previewDimension(kind, rayA, point, 1, layerId),
      ],
      lastSnap: snap,
      statusMessage: 'Dimension (angular): place dimension arc',
    };
  }

  // Final: place offset
  if (needThree && session.vertices.length >= 3) {
    const vertex = session.vertices[0]!;
    const rayA = session.vertices[1]!;
    const rayB = session.vertices[2]!;
    const offset = offsetFromPlacement(rayA, rayB, 'aligned', point);
    try {
      const opts = modelAnnotationOpts(bus);
      const dimOpts = opts.annotative
        ? annotativeDimensionCreate(opts.ann)
        : null;
      bus.execute(
        new CreateDimensionCommand(
          kind,
          rayA,
          rayB,
          offset,
          layerId,
          undefined,
          vertex,
          dimOpts
            ? { properties: dimOpts.properties, metadata: dimOpts.metadata }
            : undefined,
        ),
      );
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

  const start = session.vertices[0]!;
  const end = session.vertices[1]!;
  const offset = offsetFromPlacement(start, end, kind, point);
  try {
    const opts = modelAnnotationOpts(bus);
    const dimOpts = opts.annotative
      ? annotativeDimensionCreate(opts.ann)
      : null;
    bus.execute(
      new CreateDimensionCommand(
        kind,
        start,
        end,
        offset,
        layerId,
        undefined,
        undefined,
        dimOpts
          ? { properties: dimOpts.properties, metadata: dimOpts.metadata }
          : undefined,
      ),
    );
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
  const layerId = getCurrentLayer(doc).id;
  const opts = modelAnnotationOpts(bus);
  try {
    if (opts.annotative) {
      const created = annotativeTextCreate(opts.ann);
      bus.execute(
        new CreateTextCommand(
          session.anchor,
          trimmed,
          created.height,
          0,
          layerId,
          undefined,
          { metadata: created.metadata },
        ),
      );
    } else {
      bus.execute(
        new CreateTextCommand(
          session.anchor,
          trimmed,
          opts.textHeight,
          0,
          layerId,
        ),
      );
    }
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
  const opts = modelAnnotationOpts(bus);
  const height = opts.annotative
    ? annotativeLeaderCreate(opts.ann).textHeight
    : opts.textHeight;

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
    const opts = modelAnnotationOpts(bus);
    const height = opts.annotative
      ? annotativeLeaderCreate(opts.ann).textHeight
      : opts.textHeight;
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
  const layerId = getCurrentLayer(doc).id;
  const opts = modelAnnotationOpts(bus);
  try {
    if (opts.annotative) {
      const created = annotativeLeaderCreate(opts.ann);
      bus.execute(
        new CreateLeaderCommand(
          arrow,
          [landing],
          trimmed,
          created.textHeight,
          layerId,
          undefined,
          { properties: created.properties, metadata: created.metadata },
        ),
      );
    } else {
      bus.execute(
        new CreateLeaderCommand(
          arrow,
          [landing],
          trimmed,
          opts.textHeight,
          layerId,
        ),
      );
    }
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
