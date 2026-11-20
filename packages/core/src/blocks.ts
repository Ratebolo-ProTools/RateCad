import type { BlockContentEntity, BlockDefinition, Entity } from './types.js';

export const BLOCK_CONTENT_TYPES = [
  'line',
  'rectangle',
  'circle',
  'polyline',
  'text',
  'leader',
] as const;

export type BlockContentType = (typeof BLOCK_CONTENT_TYPES)[number];

const BLOCK_CONTENT = new Set<string>(BLOCK_CONTENT_TYPES);

export function isBlockContentType(type: string): type is BlockContentType {
  return BLOCK_CONTENT.has(type);
}

export function isBlockContentEntity(entity: Entity): entity is BlockContentEntity {
  return isBlockContentType(entity.type);
}

export function normalizeBlockName(name: string): string {
  return name.trim().toLowerCase();
}

/** Null when the name can be stored. Does not check uniqueness. */
export function blockNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a block name';
  if (trimmed.length > 64) return 'Block name must be 64 characters or fewer';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(trimmed)) {
    return 'Use letters, numbers, spaces, underscores, hyphens, or periods, and start with a letter or number';
  }
  return null;
}

export function findBlockByName(
  definitions: readonly BlockDefinition[],
  name: string,
): BlockDefinition | undefined {
  const key = normalizeBlockName(name);
  return definitions.find((definition) => normalizeBlockName(definition.name) === key);
}
