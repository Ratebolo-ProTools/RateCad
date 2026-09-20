import type { DimensionKind, Entity, EntityId, Vec2 } from '@ratecad/core';
import type { SnapResult } from '@ratecad/geometry';
import type { Camera, Grip, PreviewGeometry } from '@ratecad/viewport';

export type ToolId =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'polyline'
  | 'pan'
  | 'move'
  | 'copy'
  | 'trim'
  | 'extend'
  | 'offset'
  | 'mirror'
  | 'rotate'
  | 'scale'
  | 'dimension'
  | 'text'
  | 'leader'
  | 'wall'
  | 'door'
  | 'window';

export type InteractionMode =
  | 'idle'
  | 'draw'
  | 'grip'
  | 'window'
  | 'move'
  | 'copy'
  | 'trim'
  | 'extend'
  | 'offset'
  | 'mirror'
  | 'rotate'
  | 'scale'
  | 'dimension'
  | 'text'
  | 'leader'
  | 'text-input';

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
  /** Cutting edge / boundary / offset source entity */
  refEntityId: EntityId | null;
  /** Numeric distance (offset), radians (rotate), or scale factor */
  numericValue: number | null;
  /** Keyboard entry buffer for distances/angles/factors */
  inputBuffer: string;
  /** Rotate: first reference angle in radians */
  referenceAngle: number | null;
  /** Scale: first reference length from base point */
  scaleRefLength: number | null;
  /** Dimension kind when Dimension tool is active */
  dimKind: DimensionKind;
  /** Pending text content for text/leader placement dialog */
  pendingText: string | null;
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
    refEntityId: null,
    numericValue: null,
    inputBuffer: '',
    referenceAngle: null,
    scaleRefLength: null,
    dimKind: 'aligned',
    pendingText: null,
  };
}

export function toolStatus(tool: ToolId, dimKind: DimensionKind = 'aligned'): string {
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
    case 'trim':
      return 'Trim: select cutting edge';
    case 'extend':
      return 'Extend: select boundary edge';
    case 'offset':
      return 'Offset: select object';
    case 'mirror':
      return 'Mirror: select object(s), then specify mirror axis';
    case 'rotate':
      return 'Rotate: select object(s), then specify base point';
    case 'scale':
      return 'Scale: select object(s), then specify base point';
    case 'dimension':
      return `Dimension (${dimKind}): specify first point`;
    case 'text':
      return 'Text: specify insertion point';
    case 'leader':
      return 'Leader: specify arrow point';
    case 'wall':
      return 'Wall: specify first point (type thickness+Enter first)';
    case 'door':
      return 'Door: select host wall';
    case 'window':
      return 'Window: select host wall';
  }
}

export function setActiveTool(
  session: ToolSession,
  tool: ToolId,
  opts?: { dimKind?: DimensionKind },
): ToolSession {
  const dimKind = opts?.dimKind ?? session.dimKind ?? 'aligned';
  return {
    ...createToolSession(tool),
    activeTool: tool,
    dimKind,
    statusMessage: toolStatus(tool, dimKind),
  };
}

export function cancelTool(session: ToolSession): ToolSession {
  return {
    ...createToolSession(session.activeTool),
    activeTool: session.activeTool,
    dimKind: session.dimKind,
    statusMessage: toolStatus(session.activeTool, session.dimKind),
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
