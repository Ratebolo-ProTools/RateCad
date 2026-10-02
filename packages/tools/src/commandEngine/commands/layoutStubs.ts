import type { CadEngineCommand } from '../types.js';

/**
 * Foundation stubs for layout-related AutoCAD-style commands.
 * Full behavior arrives in later parts — do not fake functionality.
 */
function notImplemented(
  id: string,
  name: string,
  aliases: string[],
  description: string,
): CadEngineCommand {
  return {
    id,
    name,
    aliases,
    description,
    tool: 'select',
    category: 'Other',
    keywords: aliases.map((a) => a.toLowerCase()),
    start: () => ({
      prompt: {
        id: 'unimplemented',
        message: `${name}: Command not implemented yet.`,
        inputType: 'string',
        optional: true,
      },
      status: `${name}: Command not implemented yet.`,
    }),
    onPoint: () => ({
      kind: 'complete',
      status: `${name}: Command not implemented yet.`,
      message: `${name}: Command not implemented yet.`,
    }),
    onText: () => ({
      kind: 'complete',
      status: `${name}: Command not implemented yet.`,
      message: `${name}: Command not implemented yet.`,
    }),
  };
}

export const layoutCommand = notImplemented(
  'layout',
  'LAYOUT',
  ['LAYOUT'],
  'Manage drawing layouts (Paper Space sheets)',
);

export const mspaceCommand = notImplemented(
  'mspace',
  'MSPACE',
  ['MSPACE', 'MS'],
  'Enter Model Space through a layout viewport',
);

export const pspaceCommand = notImplemented(
  'pspace',
  'PSPACE',
  ['PSPACE', 'PS'],
  'Return to Paper Space from a layout viewport',
);

export const mviewCommand = notImplemented(
  'mview',
  'MVIEW',
  ['MVIEW', 'MV'],
  'Create layout viewports',
);
