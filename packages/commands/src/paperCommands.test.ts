import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommandBus,
  ApplyTitleBlockCommand,
  CreatePaperDimensionCommand,
  CreatePaperLeaderCommand,
  CreatePaperTextCommand,
  DeletePaperEntitiesCommand,
  UpdateLayoutPageSettingsCommand,
  UpdateSheetInfoCommand,
} from '../src/index.js';
import {
  createEmptyDocument,
  getActiveLayout,
  resetIdCounter,
  setActiveLayout,
  TITLE_BLOCK_LAYER_ID,
} from '@ratecad/core';

describe('paper space drafting commands', () => {
  beforeEach(() => resetIdCounter());

  function paperBus() {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    return { bus, layoutId };
  }

  it('creates paper text that does not appear in Model Space', () => {
    const { bus, layoutId } = paperBus();
    const modelBefore = bus.getDocument().entities.length;
    bus.execute(
      new CreatePaperTextCommand(layoutId, { x: 20, y: 30 }, 'PROJECT NAME'),
    );
    const doc = bus.getDocument();
    expect(doc.entities.length).toBe(modelBefore);
    expect(getActiveLayout(doc)!.paperSpaceEntities).toHaveLength(1);
    expect(getActiveLayout(doc)!.paperSpaceEntities[0]!.type).toBe('text');
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.paperSpaceEntities).toHaveLength(
      0,
    );
  });

  it('creates paper horizontal/vertical/aligned dimensions', () => {
    const { bus, layoutId } = paperBus();
    for (const kind of ['horizontal', 'vertical', 'aligned'] as const) {
      bus.execute(
        new CreatePaperDimensionCommand(
          layoutId,
          kind,
          { x: 10, y: 10 },
          { x: 50, y: 40 },
          8,
        ),
      );
    }
    expect(getActiveLayout(bus.getDocument())!.paperSpaceEntities).toHaveLength(
      3,
    );
    expect(bus.getDocument().entities).toHaveLength(0);
  });

  it('creates paper leaders', () => {
    const { bus, layoutId } = paperBus();
    bus.execute(
      new CreatePaperLeaderCommand(
        layoutId,
        { x: 10, y: 10 },
        [{ x: 40, y: 30 }],
        'Note',
      ),
    );
    const e = getActiveLayout(bus.getDocument())!.paperSpaceEntities[0]!;
    expect(e.type).toBe('leader');
  });

  it('applies title block and sheet info', () => {
    const { bus, layoutId } = paperBus();
    bus.execute(
      new ApplyTitleBlockCommand(layoutId, {
        project: 'RateCAD Tower',
        drawingNo: 'A-101',
      }),
    );
    const layout = getActiveLayout(bus.getDocument())!;
    expect(layout.titleBlock?.enabled).toBe(true);
    expect(layout.sheetInfo?.project).toBe('RateCAD Tower');
    expect(layout.paperSpaceEntities.length).toBeGreaterThan(4);
    expect(
      layout.paperSpaceEntities.every(
        (e) => e.layerId === TITLE_BLOCK_LAYER_ID || e.metadata?.titleBlock,
      ),
    ).toBe(true);
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.paperSpaceEntities).toHaveLength(
      0,
    );
  });

  it('changes page size without touching model entities', () => {
    const { bus, layoutId } = paperBus();
    bus.execute(
      new CreatePaperTextCommand(layoutId, { x: 1, y: 1 }, 'x'),
    );
    const model = bus.getDocument().entities.length;
    bus.execute(
      new UpdateLayoutPageSettingsCommand(layoutId, {
        paperSize: 'A1',
        orientation: 'portrait',
        units: 'mm',
        margin: 15,
      }),
    );
    expect(getActiveLayout(bus.getDocument())!.pageSettings.paperSize).toBe(
      'A1',
    );
    expect(getActiveLayout(bus.getDocument())!.pageSettings.orientation).toBe(
      'portrait',
    );
    expect(bus.getDocument().entities.length).toBe(model);
  });

  it('updates sheet info and refreshes title block text', () => {
    const { bus, layoutId } = paperBus();
    bus.execute(new ApplyTitleBlockCommand(layoutId));
    bus.execute(
      new UpdateSheetInfoCommand(layoutId, {
        project: 'New Project',
        drawingTitle: 'PLAN',
        drawingNo: 'B-1',
        scale: '1:100',
        date: '2026-10-02',
        drawnBy: 'RB',
        checkedBy: '',
        revision: '1',
      }),
    );
    expect(getActiveLayout(bus.getDocument())!.sheetInfo?.project).toBe(
      'New Project',
    );
  });

  it('deletes paper entities with undo', () => {
    const { bus, layoutId } = paperBus();
    bus.execute(
      new CreatePaperTextCommand(layoutId, { x: 5, y: 5 }, 'T'),
    );
    const id = getActiveLayout(bus.getDocument())!.paperSpaceEntities[0]!.id;
    bus.execute(new DeletePaperEntitiesCommand(layoutId, [id]));
    expect(getActiveLayout(bus.getDocument())!.paperSpaceEntities).toHaveLength(
      0,
    );
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.paperSpaceEntities).toHaveLength(
      1,
    );
  });
});
