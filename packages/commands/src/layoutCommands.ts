import {
  MIN_VIEWPORT_SIZE,
  addLayout,
  addViewport,
  removeViewport,
  renameLayout,
  replaceViewport,
  setActiveLayout,
  touchDocument,
  withViewportLayerOverride,
  type DrawingDocument,
  type LayoutId,
  type LayoutViewport,
  type ViewportId,
} from '@ratecad/core';
import type { Command } from './bus.js';

/** Replace a viewport (move / resize / scale / lock / camera). */
export class ReplaceViewportCommand implements Command {
  readonly name = 'ReplaceViewport';

  constructor(
    private readonly layoutId: LayoutId,
    private readonly before: LayoutViewport,
    private readonly after: LayoutViewport,
  ) {
    if (before.id !== after.id) {
      throw new Error('ReplaceViewportCommand requires same viewport id');
    }
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return replaceViewport(doc, this.layoutId, structuredClone(this.after));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return replaceViewport(doc, this.layoutId, structuredClone(this.before));
  }
}

export class MoveViewportCommand implements Command {
  readonly name = 'MoveViewport';
  private readonly replace: ReplaceViewportCommand;

  constructor(layoutId: LayoutId, before: LayoutViewport, delta: { x: number; y: number }) {
    const after: LayoutViewport = {
      ...structuredClone(before),
      x: before.x + delta.x,
      y: before.y + delta.y,
    };
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class ResizeViewportCommand implements Command {
  readonly name = 'ResizeViewport';
  private readonly replace: ReplaceViewportCommand;

  constructor(
    layoutId: LayoutId,
    before: LayoutViewport,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const after: LayoutViewport = {
      ...structuredClone(before),
      x: rect.x,
      y: rect.y,
      width: Math.max(MIN_VIEWPORT_SIZE, rect.width),
      height: Math.max(MIN_VIEWPORT_SIZE, rect.height),
    };
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class SetViewportScaleCommand implements Command {
  readonly name = 'SetViewportScale';
  private readonly replace: ReplaceViewportCommand;

  constructor(layoutId: LayoutId, before: LayoutViewport, scale: number) {
    if (!(scale > 0) || !Number.isFinite(scale)) {
      throw new Error(`Invalid viewport scale: ${scale}`);
    }
    const after: LayoutViewport = {
      ...structuredClone(before),
      scale,
    };
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class SetViewportLockedCommand implements Command {
  readonly name = 'SetViewportLocked';
  private readonly replace: ReplaceViewportCommand;

  constructor(layoutId: LayoutId, before: LayoutViewport, locked: boolean) {
    const after: LayoutViewport = {
      ...structuredClone(before),
      locked,
    };
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

/** Update model-space camera center / scale inside a viewport (pan/zoom). */
export class UpdateViewportViewCommand implements Command {
  readonly name = 'UpdateViewportView';
  private readonly replace: ReplaceViewportCommand;

  constructor(
    layoutId: LayoutId,
    before: LayoutViewport,
    patch: Partial<
      Pick<LayoutViewport, 'modelCenterX' | 'modelCenterY' | 'scale' | 'rotation'>
    >,
  ) {
    const after: LayoutViewport = {
      ...structuredClone(before),
      ...patch,
    };
    if (patch.scale != null && (!(patch.scale > 0) || !Number.isFinite(patch.scale))) {
      throw new Error(`Invalid viewport scale: ${patch.scale}`);
    }
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class CreateViewportCommand implements Command {
  readonly name = 'CreateViewport';

  constructor(
    private readonly layoutId: LayoutId,
    private readonly viewport: LayoutViewport,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    return addViewport(doc, this.layoutId, structuredClone(this.viewport));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeViewport(doc, this.layoutId, this.viewport.id);
  }
}

export class DeleteViewportCommand implements Command {
  readonly name = 'DeleteViewport';
  private readonly removed: LayoutViewport;

  constructor(
    private readonly layoutId: LayoutId,
    viewport: LayoutViewport,
  ) {
    this.removed = structuredClone(viewport);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return removeViewport(doc, this.layoutId, this.removed.id as ViewportId);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return addViewport(doc, this.layoutId, structuredClone(this.removed));
  }
}

/** Per-viewport layer visibility override (does not change global layer.visible). */
export class SetViewportLayerOverrideCommand implements Command {
  readonly name = 'SetViewportLayerOverride';
  private readonly replace: ReplaceViewportCommand;

  constructor(
    layoutId: LayoutId,
    before: LayoutViewport,
    layerId: string,
    /** true = visible, false = hidden in this VP, null = clear override */
    visible: boolean | null,
  ) {
    const after = withViewportLayerOverride(before, layerId, visible);
    this.replace = new ReplaceViewportCommand(layoutId, before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class CreateLayoutCommand implements Command {
  readonly name = 'CreateLayout';
  private createdId: LayoutId | null = null;
  private previousActive: LayoutId | null = null;

  constructor(private readonly layoutName?: string) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.previousActive = doc.activeLayoutId;
    const { document, layout } = addLayout(doc, this.layoutName);
    this.createdId = layout.id;
    return document;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.createdId) return doc;
    const layouts = (doc.layouts ?? []).filter((l) => l.id !== this.createdId);
    return touchDocument({
      ...doc,
      layouts,
      activeLayoutId: this.previousActive,
      workspaceMode: this.previousActive == null ? 'MODEL_SPACE' : 'PAPER_SPACE',
    });
  }
}

export class RenameLayoutCommand implements Command {
  readonly name = 'RenameLayout';
  private beforeName = '';

  constructor(
    private readonly layoutId: LayoutId,
    private readonly newName: string,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = doc.layouts.find((l) => l.id === this.layoutId);
    if (!layout) return doc;
    this.beforeName = layout.name;
    return renameLayout(doc, this.layoutId, this.newName);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.beforeName) return doc;
    return renameLayout(doc, this.layoutId, this.beforeName);
  }
}

export class SetActiveLayoutCommand implements Command {
  readonly name = 'SetActiveLayout';
  private previous: LayoutId | null = null;

  constructor(private readonly layoutId: LayoutId | null) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.previous = doc.activeLayoutId;
    return setActiveLayout(doc, this.layoutId);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return setActiveLayout(doc, this.previous);
  }
}
