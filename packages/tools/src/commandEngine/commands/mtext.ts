/**
 * MT / MTEXT — pick a boundary, then open the in-place multiline editor.
 * The command does not create an entity. Finish in the editor commits it.
 */

import { getActiveDimensionStyle, type Vec2 } from '@ratecad/core';
import { widthFromCorners } from '@ratecad/geometry';
import type { CommandBus } from '@ratecad/commands';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

export interface MTextCreateRequest {
  position: Vec2;
  width: number;
  height: number;
  rotation: number;
  attachment: 'TL';
}

type MTextHost = {
  openMTextEditor?: (draft: MTextCreateRequest) => void;
};

interface MTextState {
  bus: CommandBus;
  host?: MTextHost;
  height: number;
  first?: Vec2;
}

const firstCorner: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first corner',
  inputType: 'point',
};

const oppositeCorner: CadPromptDefinition = {
  id: 'opposite',
  message: 'Specify opposite corner',
  inputType: 'point',
};

function asHost(host: unknown): MTextHost | null {
  if (!host || typeof host !== 'object') return null;
  return host as MTextHost;
}

export const mtextCommand: CadEngineCommand = {
  id: 'mtext',
  name: 'MTEXT',
  aliases: ['MT', 'MTEXT'],
  description: 'Create multiline text',
  tool: 'select',
  category: 'Annotate',
  keywords: ['mtext', 'multiline', 'text', 'paragraph'],
  bootstrap: (bus, host) => {
    const doc = bus.getDocument();
    const style = getActiveDimensionStyle(
      doc.settings.dimensionStyles ?? [],
      doc.settings.activeDimensionStyleName ?? 'Standard',
    );
    const height = style.text.height > 0 ? style.text.height : 0.35;
    return {
      prompt: firstCorner,
      status: 'MTEXT: Specify first corner',
      state: { host: asHost(host), height },
    };
  },
  start: () => ({
    prompt: firstCorner,
    status: 'MTEXT: Specify first corner',
  }),
  onText: (text, prompt) => {
    if (!text) {
      return {
        kind: 'reject',
        message: 'Specify a corner, or Esc to cancel',
        prompt,
      };
    }
    return { kind: 'reject', message: 'Specify a point', prompt };
  },
  onPoint: (point, prompt, _ctx, state) => {
    const draft = state as unknown as MTextState;
    if (prompt.id === 'first' || !draft.first) {
      draft.first = point;
      return {
        kind: 'continue',
        prompt: oppositeCorner,
        status: 'MTEXT: Specify opposite corner',
        lastPoint: point,
      };
    }
    const box = widthFromCorners(draft.first, point);
    if (!box) {
      return {
        kind: 'reject',
        message: 'The text box needs a width',
        prompt: oppositeCorner,
      };
    }
    draft.host?.openMTextEditor?.({
      position: box.position,
      width: box.width,
      height: draft.height > 0 ? draft.height : 0.35,
      rotation: 0,
      attachment: 'TL',
    });
    return { kind: 'complete', status: 'MTEXT', message: null };
  },
  onMove: (point, prompt, _ctx, state) => {
    const draft = state as unknown as MTextState;
    if (prompt.id !== 'opposite' || !draft.first) return { preview: null };
    return {
      preview: { kind: 'rectangle', start: draft.first, end: point },
    };
  },
};
