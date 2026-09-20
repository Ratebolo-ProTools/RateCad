import type { CommandBus } from '@ratecad/commands';
import {
  CreateDoorCommand,
  CreateWallCommand,
  CreateWindowCommand,
} from '@ratecad/commands';
import {
  getEntity,
  getWall,
  type DoorEntity,
  type Vec2,
  type WallEntity,
  type WindowEntity,
} from '@ratecad/core';
import {
  clampHostedPosition,
  distance,
  doorLayout,
  parseLengthInput,
  projectOntoWall,
  wallLayout,
  wallLength,
  windowLayout,
  type SnapResult,
} from '@ratecad/geometry';
import { hitTestDocument, screenToleranceToWorld } from '@ratecad/viewport';
import {
  cancelTool,
  toolStatus,
  type PointerInput,
  type ToolSession,
} from './session.js';

function pickWall(
  bus: CommandBus,
  point: Vec2,
  camera: PointerInput['camera'],
): WallEntity | null {
  const tol = screenToleranceToWorld(camera, 14);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getWall(bus.getDocument(), id) ?? null;
}

function previewWall(
  start: Vec2,
  end: Vec2,
  thickness: number,
  height: number,
): WallEntity {
  return {
    id: 'preview-wall',
    type: 'wall',
    layerId: 'layer-walls',
    visible: true,
    locked: false,
    geometry: {
      start: { ...start },
      end: { ...end },
      thickness,
      height,
      justification: 'center',
    },
    properties: { material: 'Generic' },
  };
}

function previewDoor(
  wall: WallEntity,
  position: number,
  width: number,
  height: number,
): DoorEntity {
  return {
    id: 'preview-door',
    type: 'door',
    layerId: 'layer-doors',
    visible: true,
    locked: false,
    geometry: {
      hostWallId: wall.id,
      position,
      width,
      height,
      swing: 'left',
      swingAngle: Math.PI / 2,
    },
    properties: {},
  };
}

function previewWindow(
  wall: WallEntity,
  position: number,
  width: number,
  height: number,
  sill: number,
): WindowEntity {
  return {
    id: 'preview-window',
    type: 'window',
    layerId: 'layer-windows',
    visible: true,
    locked: false,
    geometry: {
      hostWallId: wall.id,
      position,
      width,
      height,
      sillHeight: sill,
    },
    properties: {},
  };
}

export function handleWallPointerDown(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const defaults = bus.getDocument().settings.constructionDefaults;
  const thickness = session.numericValue ?? defaults.wallThickness;

  if (!session.anchor) {
    return {
      ...session,
      mode: 'draw',
      anchor: point,
      vertices: [point],
      lastSnap: snap,
      statusMessage: `Wall: specify end point [thickness ${thickness}]`,
    };
  }

  if (distance(session.anchor, point) < 1e-9) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Wall: points too close',
    };
  }

  try {
    bus.execute(
      new CreateWallCommand(
        session.anchor,
        point,
        thickness,
        defaults.wallHeight,
        'center',
      ),
    );
  } catch {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: 'Wall failed: invalid geometry',
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: toolStatus('wall'),
  };
}

export function handleWallPointerMove(
  session: ToolSession,
  bus: CommandBus,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  if (!session.anchor) {
    return { ...session, lastSnap: snap, previewEntities: null };
  }
  const defaults = bus.getDocument().settings.constructionDefaults;
  const thickness = session.numericValue ?? defaults.wallThickness;
  return {
    ...session,
    lastSnap: snap,
    preview: { kind: 'line', start: session.anchor, end: point },
    previewEntities: [
      previewWall(session.anchor, point, thickness, defaults.wallHeight),
    ],
  };
}

export function commitWallThickness(
  session: ToolSession,
  bus: CommandBus,
  buffer: string,
): ToolSession {
  const units = bus.getDocument().settings.units;
  const value = parseLengthInput(buffer, units);
  if (value == null || !(value > 0)) {
    return {
      ...session,
      inputBuffer: '',
      statusMessage: 'Wall: invalid thickness',
    };
  }
  return {
    ...session,
    numericValue: value,
    inputBuffer: '',
    statusMessage: `Wall: thickness set — specify first point`,
  };
}

export function handleDoorPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const defaults = bus.getDocument().settings.constructionDefaults;
  const wall =
    (session.refEntityId
      ? getWall(bus.getDocument(), session.refEntityId)
      : null) ?? pickWall(bus, input.world, input.camera);

  if (!wall) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Door: select host wall',
    };
  }

  const proj = projectOntoWall(wall, point);
  if (!proj) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Door: invalid wall',
    };
  }

  // First click selects wall if none; second places
  if (!session.refEntityId) {
    return {
      ...session,
      mode: 'draw',
      refEntityId: wall.id,
      lastSnap: snap,
      previewEntities: [
        previewDoor(
          wall,
          clampHostedPosition(wallLength(wall), defaults.doorWidth, proj.t),
          defaults.doorWidth,
          defaults.doorHeight,
        ),
      ],
      statusMessage: 'Door: click position on wall',
    };
  }

  const position = clampHostedPosition(
    wallLength(wall),
    defaults.doorWidth,
    proj.t,
  );
  try {
    bus.execute(
      new CreateDoorCommand(
        wall.id,
        position,
        defaults.doorWidth,
        defaults.doorHeight,
      ),
    );
  } catch (err) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Door failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: toolStatus('door'),
  };
}

export function handleDoorPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const defaults = bus.getDocument().settings.constructionDefaults;
  const wall =
    (session.refEntityId
      ? getWall(bus.getDocument(), session.refEntityId)
      : null) ?? pickWall(bus, input.world, input.camera);
  if (!wall) {
    return { ...session, lastSnap: snap, previewEntities: null };
  }
  const proj = projectOntoWall(wall, point);
  if (!proj) return { ...session, lastSnap: snap };
  const position = clampHostedPosition(
    wallLength(wall),
    defaults.doorWidth,
    proj.t,
  );
  return {
    ...session,
    lastSnap: snap,
    previewEntities: [
      previewDoor(wall, position, defaults.doorWidth, defaults.doorHeight),
    ],
  };
}

export function handleWindowPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const defaults = bus.getDocument().settings.constructionDefaults;
  const wall =
    (session.refEntityId
      ? getWall(bus.getDocument(), session.refEntityId)
      : null) ?? pickWall(bus, input.world, input.camera);

  if (!wall) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Window: select host wall',
    };
  }

  const proj = projectOntoWall(wall, point);
  if (!proj) {
    return {
      ...session,
      lastSnap: snap,
      statusMessage: 'Window: invalid wall',
    };
  }

  if (!session.refEntityId) {
    return {
      ...session,
      mode: 'draw',
      refEntityId: wall.id,
      lastSnap: snap,
      previewEntities: [
        previewWindow(
          wall,
          clampHostedPosition(wallLength(wall), defaults.windowWidth, proj.t),
          defaults.windowWidth,
          defaults.windowHeight,
          defaults.windowSill,
        ),
      ],
      statusMessage: 'Window: click position on wall',
    };
  }

  const position = clampHostedPosition(
    wallLength(wall),
    defaults.windowWidth,
    proj.t,
  );
  try {
    bus.execute(
      new CreateWindowCommand(
        wall.id,
        position,
        defaults.windowWidth,
        defaults.windowHeight,
        defaults.windowSill,
      ),
    );
  } catch (err) {
    return {
      ...cancelTool(session),
      lastSnap: snap,
      statusMessage: `Window failed: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ...cancelTool(session),
    lastSnap: snap,
    statusMessage: toolStatus('window'),
  };
}

export function handleWindowPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
  point: Vec2,
  snap: SnapResult | null,
): ToolSession {
  const defaults = bus.getDocument().settings.constructionDefaults;
  const wall =
    (session.refEntityId
      ? getWall(bus.getDocument(), session.refEntityId)
      : null) ?? pickWall(bus, input.world, input.camera);
  if (!wall) {
    return { ...session, lastSnap: snap, previewEntities: null };
  }
  const proj = projectOntoWall(wall, point);
  if (!proj) return { ...session, lastSnap: snap };
  const position = clampHostedPosition(
    wallLength(wall),
    defaults.windowWidth,
    proj.t,
  );
  return {
    ...session,
    lastSnap: snap,
    previewEntities: [
      previewWindow(
        wall,
        position,
        defaults.windowWidth,
        defaults.windowHeight,
        defaults.windowSill,
      ),
    ],
  };
}

// silence unused imports used by type narrowing in future
void getEntity;
void doorLayout;
void windowLayout;
void wallLayout;
