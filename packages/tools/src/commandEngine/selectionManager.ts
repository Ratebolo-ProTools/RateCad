/**
 * SelectionManager — single source of truth for hover + selection set.
 * Document.selection remains the persisted selection; this wraps ops + hover.
 */

import type { CommandBus } from '@ratecad/commands';
import {
  clearSelection,
  setSelection,
  toggleSelectionId,
  type DrawingDocument,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  hitTestDocument,
  selectByRectangle,
  type SelectionMode,
} from '@ratecad/viewport';

export type SelectionWindowMode = SelectionMode | 'auto';

export class SelectionManager {
  hoveredId: EntityId | null = null;

  constructor(private readonly bus: CommandBus) {}

  getDocument(): DrawingDocument {
    return this.bus.getDocument();
  }

  selectedIds(): EntityId[] {
    return [...this.bus.getDocument().selection];
  }

  hasSelection(): boolean {
    return this.bus.getDocument().selection.length > 0;
  }

  select(id: EntityId): void {
    this.bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
  }

  selectMany(ids: EntityId[]): void {
    this.bus.updateWithoutHistory((doc) => setSelection(doc, ids));
  }

  add(id: EntityId): void {
    const cur = this.selectedIds();
    if (cur.includes(id)) return;
    this.bus.updateWithoutHistory((doc) => setSelection(doc, [...cur, id]));
  }

  remove(id: EntityId): void {
    this.bus.updateWithoutHistory((doc) =>
      setSelection(
        doc,
        doc.selection.filter((x) => x !== id),
      ),
    );
  }

  toggle(id: EntityId): void {
    this.bus.updateWithoutHistory((doc) => toggleSelectionId(doc, id));
  }

  clear(): void {
    this.hoveredId = null;
    this.bus.updateWithoutHistory((doc) => clearSelection(doc));
  }

  setHovered(id: EntityId | null): void {
    this.hoveredId = id;
  }

  /** Pick entity under point; returns id or null. */
  hitTest(point: Vec2, tolerance: number): EntityId | null {
    return hitTestDocument(this.getDocument(), point, tolerance);
  }

  /** Update hover from world point (does not change selection). */
  updateHover(point: Vec2, tolerance: number): EntityId | null {
    const id = this.hitTest(point, tolerance);
    this.hoveredId = id;
    return id;
  }

  selectWindow(
    a: Vec2,
    b: Vec2,
    mode: SelectionWindowMode = 'auto',
    additive = false,
  ): EntityId[] {
    const ids = selectByRectangle(this.getDocument(), a, b, mode);
    if (additive) {
      const set = new Set([...this.selectedIds(), ...ids]);
      this.selectMany([...set]);
    } else {
      this.selectMany(ids);
    }
    return ids;
  }

  /** Click empty space: clear unless additive multi-select. */
  clickEmpty(additive: boolean): void {
    if (!additive) this.clear();
  }
}
