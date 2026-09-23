import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

const handoffPrompt: CadPromptDefinition = {
  id: 'handoff',
  message: 'AREA tool active — use Object / Points / Pick Inside',
  inputType: 'string',
  optional: true,
};

/**
 * AREA command — hands off to the Area tool (shared Area Engine).
 * Geometry is never computed by the LLM; the tool calls areaEngine/boundaryEngine.
 */
export const areaCommand: CadEngineCommand = {
  id: 'area',
  name: 'AREA',
  aliases: ['AA', 'MEASUREAREA', 'MEASUREGEOM'],
  description: 'Measure area and perimeter (object, points, pick inside, add/subtract)',
  tool: 'area',
  handoffToTool: true,
  start: () => ({
    prompt: handoffPrompt,
    status: 'AREA tool active',
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};
