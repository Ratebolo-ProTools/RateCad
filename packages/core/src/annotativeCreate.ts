/**
 * Helpers for creating Model Space annotative annotations.
 * Paper Space entities must NOT use these — they keep paper-unit sizes.
 */

import {
  DEFAULT_ANNOTATION_SCALE,
  modelSizeFromPaperMm,
  type AnnotationScaleSettings,
} from './annotationScale.js';

export function resolveAnnotationSettings(
  settings?: Partial<AnnotationScaleSettings> | null,
): AnnotationScaleSettings {
  return { ...DEFAULT_ANNOTATION_SCALE, ...(settings ?? {}) };
}

/** Model world height + metadata for annotative text. */
export function annotativeTextCreate(
  ann: AnnotationScaleSettings,
): {
  height: number;
  metadata: Record<string, unknown>;
} {
  const paperMm = ann.paperTextHeightMm;
  return {
    height: modelSizeFromPaperMm(paperMm, ann.ratio),
    metadata: {
      annotative: true,
      paperHeightMm: paperMm,
      annotationRatio: ann.ratio,
    },
  };
}

export function annotativeLeaderCreate(
  ann: AnnotationScaleSettings,
): {
  textHeight: number;
  arrowSize: number;
  metadata: Record<string, unknown>;
  properties: { arrowSize: number };
} {
  const paperMm = ann.paperTextHeightMm;
  const arrowMm = ann.paperArrowSizeMm;
  const arrowSize = modelSizeFromPaperMm(arrowMm, ann.ratio);
  return {
    textHeight: modelSizeFromPaperMm(paperMm, ann.ratio),
    arrowSize,
    metadata: {
      annotative: true,
      paperHeightMm: paperMm,
      paperArrowSizeMm: arrowMm,
      annotationRatio: ann.ratio,
    },
    properties: { arrowSize },
  };
}

export function annotativeDimensionCreate(
  ann: AnnotationScaleSettings,
): {
  textHeight: number;
  arrowSize: number;
  metadata: Record<string, unknown>;
  properties: {
    textHeight: number;
    arrowSize: number;
  };
} {
  const paperMm = ann.paperDimTextHeightMm;
  const arrowMm = ann.paperArrowSizeMm;
  const textHeight = modelSizeFromPaperMm(paperMm, ann.ratio);
  const arrowSize = modelSizeFromPaperMm(arrowMm, ann.ratio);
  return {
    textHeight,
    arrowSize,
    metadata: {
      annotative: true,
      paperHeightMm: paperMm,
      paperArrowSizeMm: arrowMm,
      annotationRatio: ann.ratio,
    },
    properties: { textHeight, arrowSize },
  };
}
