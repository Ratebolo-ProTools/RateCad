import type { ToolId } from '@ratecad/tools';

/**
 * Ribbon tools that activate through CadCommandEngine.start (same path as
 * typed aliases). Keep in sync with App.tsx activateTool.
 */
export const ENGINE_TOOLS: ReadonlySet<ToolId> = new Set([
  'line',
  'polyline',
  'rectangle',
  'circle',
  'move',
  'copy',
  'trim',
  'fillet',
  'extend',
  'offset',
  'mirror',
  'rotate',
  'scale',
  'area',
]);
