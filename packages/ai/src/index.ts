import type { Command } from '@ratecad/commands';
import type { DrawingDocument } from '@ratecad/core';

/**
 * Architectural boundary for future AI commands.
 *
 * Target flow (NOT implemented in Milestone 1):
 *   User Prompt → AI → Validated DrawingCommand[] → CommandBus → DrawingDocument → Viewport
 *
 * AI must NEVER manipulate the renderer directly.
 */

export interface AiDrawingContext {
  document: DrawingDocument;
  selectedEntityIds: string[];
  units: DrawingDocument['settings']['units'];
}

export interface AiCommandProposal {
  /** Natural-language summary for the user */
  summary: string;
  /** Commands that would be executed on the shared CommandBus */
  commands: Command[];
}

export interface AiProvider {
  /**
   * Interpret a user prompt into validated commands.
   * Milestone 1: stub only — throws until Milestone 9+.
   */
  proposeCommands(
    prompt: string,
    context: AiDrawingContext,
  ): Promise<AiCommandProposal>;
}

export class AiNotImplementedError extends Error {
  constructor() {
    super(
      'AI command engine is not implemented in Milestone 1. See docs/milestones.md.',
    );
    this.name = 'AiNotImplementedError';
  }
}

/** Placeholder provider — keeps the package boundary ready for later milestones. */
export class StubAiProvider implements AiProvider {
  async proposeCommands(): Promise<AiCommandProposal> {
    throw new AiNotImplementedError();
  }
}
