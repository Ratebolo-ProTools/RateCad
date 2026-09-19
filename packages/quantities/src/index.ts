import type { DrawingDocument } from '@ratecad/core';

/**
 * Construction quantity takeoff — stub for Milestone 11.
 * No implementation in Milestone 1.
 */

export interface QuantityItem {
  category: string;
  description: string;
  quantity: number;
  unit: string;
}

export interface QuantityTakeoff {
  items: QuantityItem[];
}

export function computeQuantities(_doc: DrawingDocument): QuantityTakeoff {
  return { items: [] };
}
