import type { LayerId, Vec2 } from '@ratecad/core';

/**
 * Closed prompt-to-CAD schema for AI-2.
 * Coordinates are document world units. The parser fills this value;
 * it does not mutate a drawing.
 */
export type DrawingIntent =
  | {
      kind: 'line';
      start: Vec2;
      end: Vec2;
      /** Null uses the document's current layer at compile time. */
      layerName: string | null;
    }
  | {
      kind: 'rectangle';
      corner: Vec2;
      /** World-unit size along +X. */
      width: number;
      /** World-unit size along +Y. */
      height: number;
      /** True when the prompt omitted the corner and (0,0) was assumed. */
      originAssumed: boolean;
      layerName: string | null;
    }
  | {
      kind: 'circle';
      center: Vec2;
      /** World-unit radius. Diameter phrases are converted before this value. */
      radius: number;
      originAssumed: boolean;
      layerName: string | null;
    }
  | {
      kind: 'polyline';
      vertices: Vec2[];
      closed: boolean;
      layerName: string | null;
    };

export interface ParsedDrawPrompt {
  intent: DrawingIntent;
  /** Disclosed defaults. Empty when the prompt stated every placement. */
  assumptions: string[];
}

export interface CompiledEntitySummary {
  kind: DrawingIntent['kind'];
  layerId: LayerId;
  layerName: string;
  detail: string;
}
