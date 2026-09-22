import { CadEngineRegistry } from './registry.js';
import { circleCommand } from './commands/circle.js';
import { lineCommand } from './commands/line.js';
import { copyCommand, moveCommand } from './commands/moveCopy.js';
import { rectangleCommand } from './commands/rectangle.js';
import type { CadEngineCommand } from './types.js';

/** Tool-bridge stubs for remaining aliases (activate existing tool path). */
function toolBridge(
  id: string,
  name: string,
  aliases: string[],
  tool: CadEngineCommand['tool'],
  description: string,
): CadEngineCommand {
  return {
    id,
    name,
    aliases,
    description,
    tool,
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
    rectangleCommand,
    circleCommand,
    moveCommand,
    copyCommand,
    toolBridge('polyline', 'POLYLINE', ['PL', 'PLINE'], 'polyline', 'Draw a polyline'),
    toolBridge('trim', 'TRIM', ['TR'], 'trim', 'Trim objects'),
    toolBridge('extend', 'EXTEND', ['EX'], 'extend', 'Extend objects'),
    toolBridge('offset', 'OFFSET', ['O'], 'offset', 'Offset objects'),
    toolBridge('mirror', 'MIRROR', ['MI'], 'mirror', 'Mirror objects'),
    toolBridge('rotate', 'ROTATE', ['RO'], 'rotate', 'Rotate objects'),
    toolBridge('scale', 'SCALE', ['SC'], 'scale', 'Scale objects'),
  ];
  for (const c of commands) registry.register(c);
  return registry;
}

export { CadCommandEngine } from './engine.js';
export { CadCommandHistory } from './history.js';
export { CadEngineRegistry } from './registry.js';
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
  CadCommandContext,
  CadCommandUiState,
  CadDynamicInput,
  CadEngineCommand,
  CadInputType,
  CadPromptDefinition,
} from './types.js';
export { setEngineRectangleConstraints } from './commands/rectangle.js';
export { CIRCLE_DEFAULT_RADIUS } from './commands/circle.js';
