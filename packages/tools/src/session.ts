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
  | 'window'
  | 'room';

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
  /**
   * Rectangle tool: optional constrained length (|Δx| in world units).
   * null = unconstrained (derived from cursor).
   */
  rectLength: number | null;
  /**
   * Rectangle tool: optional constrained width (|Δy| in world units).
   * null = unconstrained (derived from cursor).
   */
  rectWidth: number | null;
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
    rectLength: null,
    rectWidth: null,
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
    case 'room':
      return 'Room: click inside a closed wall loop';
  }
}

export function setActiveTool(
  session: ToolSession,
  tool: ToolId,
  opts?: {
    dimKind?: DimensionKind;
    rectLength?: number | null;
    rectWidth?: number | null;
  },
): ToolSession {
  const dimKind = opts?.dimKind ?? session.dimKind ?? 'aligned';
  const next = {
    ...createToolSession(tool),
    activeTool: tool,
    dimKind,
    statusMessage: toolStatus(tool, dimKind),
  };
  if (tool === 'rectangle') {
    next.rectLength =
      opts?.rectLength != null && opts.rectLength > 0 ? opts.rectLength : null;
    next.rectWidth =
      opts?.rectWidth != null && opts.rectWidth > 0 ? opts.rectWidth : null;
  }
  return next;
}

export function cancelTool(session: ToolSession): ToolSession {
  const base: ToolSession = {
    ...createToolSession(session.activeTool),
    activeTool: session.activeTool,
    dimKind: session.dimKind,
    rectLength: session.rectLength,
    rectWidth: session.rectWidth,
    statusMessage: toolStatus(session.activeTool, session.dimKind),
  };
  if (session.activeTool === 'rectangle') {
    const L =
      session.rectLength != null ? `L=${session.rectLength} (fixed)` : 'L=free';
    const W =
      session.rectWidth != null ? `W=${session.rectWidth} (fixed)` : 'W=free';
    base.statusMessage = `Rectangle: ${L} × ${W} — specify first corner`;
  }
  return base;
}

export interface PointerInput {
  world: Vec2;
  camera: Camera;
  detail?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}
