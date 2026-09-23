import type { CommandBus } from '@ratecad/commands';
import { DeleteEntitiesCommand } from '@ratecad/commands';
import { getSelectedEntities, isEntityModifiable } from '@ratecad/core';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

const selectPrompt: CadPromptDefinition = {
  id: 'select',
  message: 'Select objects to erase:',
  inputType: 'entities',
  optional: true,
};

function eraseSelection(bus: CommandBus): ReturnType<CadEngineCommand['onText']> {
  const entities = getSelectedEntities(bus.getDocument()).filter((e) =>
    isEntityModifiable(bus.getDocument(), e),
  );
  if (!entities.length) {
    return {
      kind: 'reject',
      message: 'No objects selected',
      prompt: selectPrompt,
    };
  }
  bus.execute(new DeleteEntitiesCommand(entities.map((e) => e.id)));
  return {
    kind: 'complete',
    status: `Erased ${entities.length} object(s)`,
  };
}

/** ERASE — deletes current selection (or waits for selection + Enter). */
export const eraseCommand: CadEngineCommand = {
  id: 'erase',
  name: 'ERASE',
  aliases: ['E', 'DEL'],
  description: 'Delete selected objects',
  tool: 'select',
  category: 'Modify',
  keywords: ['erase', 'delete', 'remove'],
  start: (ctx) => {
    if (ctx.selectedIds.length > 0) {
      return {
        prompt: {
          id: 'confirm',
          message: 'Press Enter to erase selection:',
          inputType: 'entities',
          optional: true,
          defaultValue: '',
        },
        status: `ERASE: ${ctx.selectedIds.length} selected — Enter to confirm`,
      };
    }
    return {
      prompt: selectPrompt,
      status: 'ERASE: Select objects:',
    };
  },
  onPoint: () => ({
    kind: 'reject',
    message: 'Select objects, then press Enter',
    prompt: selectPrompt,
  }),
  onText: (_text, prompt, _ctx, state) => {
    const bus = (state as { bus: CommandBus }).bus;
    if (prompt.id === 'confirm' || prompt.id === 'select') {
      return eraseSelection(bus);
    }
    return eraseSelection(bus);
  },
};
