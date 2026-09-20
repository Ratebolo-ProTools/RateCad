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
  isEntityModifiable,
  setSelection,
  toggleSelectionId,
  type DoorEntity,
  type Entity,
  type Vec2,
  type WindowEntity,
} from '@ratecad/core';
import {
  applyGripEdit,
  clampHostedPosition,
  distance,
  projectOntoWall,
  resolveSnap,
  translateEntity,
  vecDelta,
  wallLength,
  type SnapResult,
} from '@ratecad/geometry';
import {
  getSelectionGrips,
  hitTestDocument,
  hitTestGrip,
  screenToleranceToWorld,
  selectByRectangle,
} from '@ratecad/viewport';
import {
  commitLeaderContent,
  commitTextContent,
  handleDimensionPointerDown,
  handleDimensionPointerMove,
  handleLeaderPointerDown,
  handleLeaderPointerMove,
  handleTextPointerDown,
} from './annotationTools.js';
import {
  commitWallThickness,
  handleDoorPointerDown,
  handleDoorPointerMove,
  handleRoomPointerDown,
  handleRoomPointerMove,
  handleWallPointerDown,
  handleWallPointerMove,
  handleWindowPointerDown,
  handleWindowPointerMove,
} from './constructionTools.js';
import {
  commitOffsetDistance,
  commitRotateAngle,
  commitScaleFactor,
  handleExtendPointerDown,
  handleExtendPointerMove,
  handleMirrorPointerDown,
  handleMirrorPointerMove,
  handleOffsetPointerDown,
  handleOffsetPointerMove,
  handleRotatePointerDown,
  handleRotatePointerMove,
  handleScalePointerDown,
  handleScalePointerMove,
  handleTrimPointerDown,
  handleTrimPointerMove,
} from './cadModifyTools.js';
import {
  cancelTool,
  createToolSession,
  setActiveTool,
  toolStatus,
  type PointerInput,
  type ToolId,
  type ToolSession,
} from './session.js';

export type {
  InteractionMode,
  PointerInput,
  ToolId,
  ToolSession,
} from './session.js';
export {
  cancelTool,
  createToolSession,
  setActiveTool,
  toolStatus,
} from './session.js';
export {
  commitOffsetDistance,
  commitRotateAngle,
  commitScaleFactor,
} from './cadModifyTools.js';
export {
  commitLeaderContent,
  commitTextContent,
} from './annotationTools.js';
export { commitWallThickness } from './constructionTools.js';

function snapPoint(
  world: Vec2,
  bus: CommandBus,
  camera: PointerInput['camera'],
): SnapResult {
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

function modifiableSelected(bus: CommandBus): Entity[] {
  const doc = bus.getDocument();
  return getSelectedEntities(doc).filter((e) => isEntityModifiable(doc, e));
}

export function handleToolPointerDown(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  // Block drawing tools while text dialog is open
  if (session.mode === 'text-input') {
    return session;
  }

  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;
  const multi = !!(input.ctrlKey || input.metaKey);

  if (session.activeTool === 'select') {
    if (session.mode === 'window' && session.anchor) {
      return session;
    }

    const selected = selectedOrMessage(bus);
    if (selected.length > 0 && !multi) {
      const grips = getSelectionGrips(selected, bus.getDocument().entities);
      const gripTol = screenToleranceToWorld(input.camera, 8);
      const grip = hitTestGrip(grips, point, gripTol);
      if (grip) {
        const entity = getEntity(bus.getDocument(), grip.entityId);
        if (entity) {
          if (!isEntityModifiable(bus.getDocument(), entity)) {
            return {
              ...session,
              lastSnap: snap,
              statusMessage: 'Locked layer — cannot edit',
            };
          }
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

  if (session.activeTool === 'dimension') {
    return handleDimensionPointerDown(session, bus, point, snap);
  }
  if (session.activeTool === 'text') {
    return handleTextPointerDown(session, point, snap);
  }
  if (session.activeTool === 'leader') {
    return handleLeaderPointerDown(session, bus, point, snap);
  }
  if (session.activeTool === 'wall') {
    return handleWallPointerDown(session, bus, point, snap);
  }
  if (session.activeTool === 'door') {
    return handleDoorPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'window') {
    return handleWindowPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'room') {
    return handleRoomPointerDown(session, bus, input, point, snap);
  }

  if (session.activeTool === 'trim') {
    return handleTrimPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'extend') {
    return handleExtendPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'offset') {
    return handleOffsetPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'mirror') {
    return handleMirrorPointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'rotate') {
    return handleRotatePointerDown(session, bus, input, point, snap);
  }
  if (session.activeTool === 'scale') {
    return handleScalePointerDown(session, bus, input, point, snap);
  }

  if (session.activeTool === 'move') {
    const selected = modifiableSelected(bus);
    if (selected.length === 0) {
      const tol = screenToleranceToWorld(input.camera, 8);
      const id = hitTestDocument(bus.getDocument(), point, tol);
      if (id) {
        const ent = getEntity(bus.getDocument(), id);
        if (ent && !isEntityModifiable(bus.getDocument(), ent)) {
          return {
            ...session,
            lastSnap: snap,
            statusMessage: 'Locked layer — cannot move',
          };
        }
        bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
        return {
          ...session,
          mode: 'idle',
          lastSnap: snap,
          statusMessage: 'Move: specify base point',
        };
      }
      const all = selectedOrMessage(bus);
      if (all.length > 0) {
        return {
          ...session,
          lastSnap: snap,
          statusMessage: 'Move: selection is locked',
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
      bus.execute(
        new MoveEntitiesCommand(selected, delta, bus.getDocument().entities),
      );
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

  if (session.activeTool === 'copy') {
    const selected = modifiableSelected(bus);
    // Copy is allowed from locked layers visually but creates new entities —
    // still require source to be selectable; allow copy of locked for organization?
    // Spec: locked cannot be modified. Copy doesn't modify source — allow all selected.
    const toCopy =
      selected.length > 0 ? selected : selectedOrMessage(bus);
    if (toCopy.length === 0) {
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
        previewEntities: toCopy.map((e) => structuredClone(e)),
        hideEntityIds: [],
        lastSnap: snap,
        statusMessage: 'Copy: specify destination (Esc to finish)',
      };
    }

    const delta = vecDelta(session.anchor, point);
    try {
      bus.execute(
        new CopyEntitiesCommand(toCopy, delta, bus.getDocument().entities),
      );
      return {
        ...session,
        mode: 'copy',
        anchor: session.anchor,
        previewEntities: toCopy.map((e) => structuredClone(e)),
        hideEntityIds: [],
        lastSnap: snap,
        statusMessage: `Copied ${toCopy.length} — click next destination or Esc`,
      };
    } catch {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Copy failed: invalid geometry',
      };
    }
  }

  if (session.activeTool === 'polyline') {
    const verts = [...session.vertices, point];
    if ((input.detail ?? 1) >= 2 && session.vertices.length >= 1) {
      const cleaned = [
        ...(session.vertices.length >= 2 ? session.vertices : verts),
      ];
      if (
        cleaned.length >= 2 &&
        distance(cleaned[cleaned.length - 1]!, cleaned[cleaned.length - 2]!) <
          1e-9
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

  if (
    session.activeTool === 'line' ||
    session.activeTool === 'rectangle' ||
    session.activeTool === 'circle'
  ) {
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

  return { ...session, lastSnap: snap };
}

export function handleToolPointerMove(
  session: ToolSession,
  bus: CommandBus,
  input: PointerInput,
): ToolSession {
  if (session.mode === 'text-input') {
    return session;
  }

  const snap = snapPoint(input.world, bus, input.camera);
  const point = snap.point;

  if (session.mode === 'grip' && session.grip && session.gripEntity) {
    let preview = applyGripEdit(
      session.gripEntity,
      session.grip.editTarget,
      point,
    );
    if (
      !preview &&
      (session.gripEntity.type === 'door' ||
        session.gripEntity.type === 'window')
    ) {
      const host = getEntity(
        bus.getDocument(),
        session.gripEntity.geometry.hostWallId,
      );
      if (host?.type === 'wall') {
        const proj = projectOntoWall(host, point);
        if (proj) {
          const position = clampHostedPosition(
            wallLength(host),
            session.gripEntity.geometry.width,
            proj.t,
          );
          if (session.gripEntity.type === 'door') {
            preview = {
              ...session.gripEntity,
              geometry: { ...session.gripEntity.geometry, position },
            } satisfies DoorEntity;
          } else {
            preview = {
              ...session.gripEntity,
              geometry: { ...session.gripEntity.geometry, position },
            } satisfies WindowEntity;
          }
        }
      }
    }
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

  if ((session.mode === 'move' || session.mode === 'copy') && session.anchor) {
    const selected =
      session.mode === 'move'
        ? modifiableSelected(bus)
        : selectedOrMessage(bus);
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

  if (session.activeTool === 'dimension') {
    return handleDimensionPointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'leader') {
    return handleLeaderPointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'wall') {
    return handleWallPointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'door') {
    return handleDoorPointerMove(session, bus, input, point, snap);
  }
  if (session.activeTool === 'window') {
    return handleWindowPointerMove(session, bus, input, point, snap);
  }
  if (session.activeTool === 'room') {
    return handleRoomPointerMove(session, bus, input, point, snap);
  }

  if (session.activeTool === 'trim') {
    return handleTrimPointerMove(session, bus, input, point, snap);
  }
  if (session.activeTool === 'extend') {
    return handleExtendPointerMove(session, bus, input, point, snap);
  }
  if (session.activeTool === 'offset') {
    return handleOffsetPointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'mirror') {
    return handleMirrorPointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'rotate') {
    return handleRotatePointerMove(session, bus, point, snap);
  }
  if (session.activeTool === 'scale') {
    return handleScalePointerMove(session, bus, point, snap);
  }

  if (session.activeTool === 'select' || session.activeTool === 'pan' || session.activeTool === 'text') {
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

  if (session.mode === 'grip' && session.grip && session.gripEntity) {
    if (!isEntityModifiable(bus.getDocument(), session.gripEntity)) {
      return {
        ...cancelTool(session),
        lastSnap: snap,
        statusMessage: 'Locked layer — grip edit canceled',
      };
    }
    try {
      const hostWall =
        session.gripEntity.type === 'door' || session.gripEntity.type === 'window'
          ? getEntity(bus.getDocument(), session.gripEntity.geometry.hostWallId)
          : undefined;
      bus.execute(
        new MoveEntityGripCommand(
          session.gripEntity,
          session.grip.editTarget,
          point,
          hostWall?.type === 'wall' ? hostWall : undefined,
          bus.getDocument().entities,
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

  if (session.mode === 'window' && session.anchor) {
    const ids = selectByRectangle(
      bus.getDocument(),
      session.anchor,
      point,
      'auto',
    );
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

/** Commit numeric keyboard entry for offset / rotate / scale. */
export function commitNumericInput(
  session: ToolSession,
  bus: CommandBus,
): ToolSession {
  const buffer = session.inputBuffer;
  if (!buffer.trim()) return session;

  if (session.activeTool === 'offset' && session.refEntityId) {
    return commitOffsetDistance(session, buffer);
  }
  if (session.activeTool === 'wall') {
    return commitWallThickness(session, bus, buffer);
  }
  if (session.activeTool === 'rotate' && session.anchor) {
    const next = commitRotateAngle(session, buffer);
    return next;
  }
  if (session.activeTool === 'scale' && session.anchor) {
    return commitScaleFactor(session, buffer);
  }
  void bus;
  return { ...session, inputBuffer: '', statusMessage: session.statusMessage };
}

export function appendInputBuffer(
  session: ToolSession,
  ch: string,
): ToolSession {
  if (!/^[0-9.\-]$/.test(ch) && ch !== 'Backspace') return session;
  if (ch === 'Backspace') {
    return {
      ...session,
      inputBuffer: session.inputBuffer.slice(0, -1),
      statusMessage: `${toolStatus(session.activeTool as ToolId)} [${session.inputBuffer.slice(0, -1) || '…'}]`,
    };
  }
  const inputBuffer = session.inputBuffer + ch;
  return {
    ...session,
    inputBuffer,
    statusMessage: `${session.statusMessage.split('[')[0]!.trim()} [${inputBuffer}]`,
  };
}
