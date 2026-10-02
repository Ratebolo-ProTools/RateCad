import { CadEngineRegistry } from './registry.js';
import { areaCommand } from './commands/area.js';
import { circleCommand } from './commands/circle.js';
import { eraseCommand } from './commands/erase.js';
import { lineCommand } from './commands/line.js';
import { copyCommand, moveCommand } from './commands/moveCopy.js';
import { rectangleCommand } from './commands/rectangle.js';
import { trimCommand } from './commands/trim.js';
import { filletCommand } from './commands/fillet.js';
import {
  chpropCommand,
  matchPropCommand,
  propertiesCommand,
  setByLayerCommand,
} from './commands/properties.js';
import {
  layoutCommand,
  mspaceCommand,
  mviewCommand,
  pspaceCommand,
} from './commands/layoutStubs.js';
import type { CadCommandCategory, CadEngineCommand } from './types.js';

/** Tool-bridge stubs for remaining aliases (activate existing tool path). */
function toolBridge(
  id: string,
  name: string,
  aliases: string[],
  tool: CadEngineCommand['tool'],
  description: string,
  opts?: {
    keywords?: string[];
    category?: CadCommandCategory;
  },
): CadEngineCommand {
  return {
    id,
    name,
    aliases,
    description,
    tool,
    keywords: opts?.keywords,
    category: opts?.category ?? 'Other',
    handoffToTool: true,
    start: () => ({
      prompt: {
        id: 'handoff',
        message: `${name} tool active`,
        inputType: 'string',
        optional: true,
      },
      status: `${name} tool active`,
    }),
    onPoint: () => ({ kind: 'complete' }),
    onText: () => ({ kind: 'complete' }),
  };
}

export function createDefaultEngineRegistry(): CadEngineRegistry {
  const registry = new CadEngineRegistry();
  const commands: CadEngineCommand[] = [
    lineCommand,
    {
      ...rectangleCommand,
      category: 'Draw',
      keywords: ['rectangle', 'rect', 'box', 'square'],
    },
    circleCommand,
    moveCommand,
    copyCommand,
    areaCommand,
    eraseCommand,
    trimCommand,
    filletCommand,
    propertiesCommand,
    chpropCommand,
    setByLayerCommand,
    matchPropCommand,
    layoutCommand,
    mspaceCommand,
    pspaceCommand,
    mviewCommand,
    toolBridge('polyline', 'POLYLINE', ['PL', 'PLINE'], 'polyline', 'Draw a polyline', {
      category: 'Draw',
      keywords: ['polyline', 'pline', 'path', 'arc'],
    }),
    toolBridge('extend', 'EXTEND', ['EX'], 'extend', 'Extend objects', {
      category: 'Modify',
      keywords: ['extend', 'lengthen'],
    }),
    toolBridge('offset', 'OFFSET', ['O'], 'offset', 'Offset objects', {
      category: 'Modify',
      keywords: ['offset', 'parallel'],
    }),
    toolBridge('mirror', 'MIRROR', ['MI'], 'mirror', 'Mirror objects', {
      category: 'Modify',
      keywords: ['mirror', 'reflect', 'flip'],
    }),
    toolBridge('rotate', 'ROTATE', ['RO'], 'rotate', 'Rotate objects', {
      category: 'Modify',
      keywords: ['rotate', 'turn', 'angle'],
    }),
    toolBridge('scale', 'SCALE', ['SC'], 'scale', 'Scale objects', {
      category: 'Modify',
      keywords: ['scale', 'resize'],
    }),
    toolBridge('dimension', 'DIMENSION', ['DIM'], 'dimension', 'Create dimensions', {
      category: 'Annotate',
      keywords: ['dimension', 'measure', 'distance', 'length'],
    }),
    toolBridge('text', 'TEXT', ['DT'], 'text', 'Place text', {
      category: 'Annotate',
      keywords: ['text', 'label', 'annotation'],
    }),
    toolBridge('wall', 'WALL', ['WA'], 'wall', 'Draw a wall', {
      category: 'Construction',
      keywords: ['wall', 'partition'],
    }),
    toolBridge('door', 'DOOR', ['DR'], 'door', 'Place a door', {
      category: 'Construction',
      keywords: ['door', 'opening'],
    }),
    toolBridge('window', 'WINDOW', ['WI'], 'window', 'Place a window', {
      category: 'Construction',
      keywords: ['window', 'glazing'],
    }),
    toolBridge('room', 'ROOM', ['RM'], 'room', 'Create a room from walls', {
      category: 'Construction',
      keywords: ['room', 'space'],
    }),
  ];
  for (const c of commands) registry.register(c);
  return registry;
}

export { CadCommandEngine } from './engine.js';
export { CadCommandHistory } from './history.js';
export { CadEngineRegistry } from './registry.js';
export { CommandUsageTracker } from './usage.js';
export { SelectionManager } from './selectionManager.js';
export {
  classifyActiveCommandInput,
  classifyIdleCommandInput,
  editDistance,
} from './inputClassifier.js';
export {
  isCadKeyboardCaptureContext,
  resolveKeyboardContextFromTarget,
  spaceConfirmsCommand,
  type KeyboardContext,
} from './keyboardContext.js';
export {
  formatDefaultHint,
  formatOptionsHint,
  matchOption,
  parseAngleInput,
  parseDistanceInput,
  parsePointInput,
  pointFromDirectDistance,
} from './parsers.js';
export type {
  CadCommandCategory,
  CadCommandContext,
  CadCommandUiState,
  CadDynamicInput,
  CadEngineCommand,
  CadInputType,
  CadPromptDefinition,
  CommandSuggestion,
} from './types.js';
export type { EscAction } from './engine.js';
export { setEngineRectangleConstraints } from './commands/rectangle.js';
export { CIRCLE_DEFAULT_RADIUS } from './commands/circle.js';
