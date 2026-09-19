import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  createEntityId,
  getEntity,
  resetIdCounter,
} from '../src/index.js';

describe('DrawingDocument', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates an empty document with default layer and units', () => {
    const doc = createEmptyDocument('Test');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.meta.name).toBe('Test');
    expect(doc.entities).toEqual([]);
    expect(doc.layers).toHaveLength(1);
    expect(doc.settings.units).toBe('ft');
    expect(doc.selection).toEqual([]);
  });

  it('creates stable unique entity ids', () => {
    const a = createEntityId('line');
    const b = createEntityId('line');
    expect(a).not.toBe(b);
    expect(a.startsWith('line-')).toBe(true);
  });

  it('getEntity returns undefined for missing ids', () => {
    const doc = createEmptyDocument();
    expect(getEntity(doc, 'missing')).toBeUndefined();
  });
});
