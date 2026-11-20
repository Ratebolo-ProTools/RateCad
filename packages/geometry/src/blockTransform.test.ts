import { describe, expect, it } from 'vitest';
import type { BlockReferenceEntity } from '@ratecad/core';
import {
  hitTestBlockReference,
  inverseBlockPoint,
  transformBlockPoint,
} from './blockTransform.js';

function reference(
  geometry: Partial<BlockReferenceEntity['geometry']> = {},
): BlockReferenceEntity {
  return {
    id: 'block-1',
    type: 'block',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    properties: {},
    geometry: {
      definitionId: 'bdef-1',
      position: { x: 10, y: 10 },
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      ...geometry,
    },
  };
}

const definition = {
  id: 'bdef-1',
  name: 'Mark',
  basePoint: { x: 0, y: 0 },
  entities: [
    {
      id: 'line-a',
      type: 'line' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      properties: {},
      geometry: { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
    },
    {
      id: 'circle-a',
      type: 'circle' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      properties: {},
      geometry: { center: { x: 0, y: 0 }, radius: 1 },
    },
  ],
};

describe('block transforms', () => {
  it('round-trips scale, rotation, and translation', () => {
    const ref = reference({
      position: { x: -3, y: 4 },
      scaleX: 2,
      scaleY: -0.5,
      rotation: Math.PI / 3,
    });
    const local = { x: 1.25, y: -2 };
    const world = transformBlockPoint(local, ref);
    expect(inverseBlockPoint(world, ref)).toEqual({
      x: expect.closeTo(local.x, 8),
      y: expect.closeTo(local.y, 8),
    });
  });

  it('hits rotated, negative, and nonuniform geometry as one reference', () => {
    const rotated = reference({ rotation: Math.PI / 2 });
    expect(
      hitTestBlockReference(rotated, [definition], { x: 10, y: 11 }, 0.05),
    ).toBe(true);
    expect(
      hitTestBlockReference(rotated, [definition], { x: 12, y: 10 }, 0.05),
    ).toBe(false);

    const flipped = reference({ scaleX: -1, scaleY: 1, rotation: 0 });
    expect(
      hitTestBlockReference(flipped, [definition], { x: 9, y: 10 }, 0.05),
    ).toBe(true);

    const stretched = reference({
      position: { x: 0, y: 0 },
      scaleX: 2,
      scaleY: 0.5,
      rotation: 0,
    });
    expect(
      hitTestBlockReference(stretched, [definition], { x: 2, y: 0 }, 0.05),
    ).toBe(true);
    expect(
      hitTestBlockReference(stretched, [definition], { x: 0, y: 1 }, 0.05),
    ).toBe(false);
  });
});
