/**
 * Annotation scale foundation — reusable model for Model Space annotations
 * that should remain readable through layout viewports.
 *
 * Paper Space annotations are separate and ignore this service.
 */

import {
  VIEWPORT_SCALE_PRESETS,
  scaleFromRatio,
  type ViewportScalePreset,
} from './layout.js';
import type { LengthUnit } from './types.js';

/** Document-level annotation scale settings. */
export interface AnnotationScaleSettings {
  /** Denominator N for scale 1:N (e.g. 100 → 1:100). */
  ratio: number;
  /** Default paper display height for model text (millimetres). */
  paperTextHeightMm: number;
  /** Default paper display height for model dimension text (mm). */
  paperDimTextHeightMm: number;
  /** Default paper arrow size for model dims/leaders (mm). */
  paperArrowSizeMm: number;
  /** When true, new model text/dim/leader are annotative by default. */
  annotativeByDefault: boolean;
}

export const DEFAULT_ANNOTATION_SCALE: AnnotationScaleSettings = {
  ratio: 50,
  paperTextHeightMm: 2.5,
  paperDimTextHeightMm: 2.5,
  paperArrowSizeMm: 2.0,
  annotativeByDefault: true,
};

export const ANNOTATION_SCALE_PRESETS = VIEWPORT_SCALE_PRESETS;

export function formatAnnotationScale(ratio: number): string {
  const preset = ANNOTATION_SCALE_PRESETS.find((n) => n === Math.round(ratio));
  if (preset != null) return `1:${preset}`;
  const r = Math.round(ratio * 1000) / 1000;
  return `1:${r}`;
}

export function isAnnotationScalePreset(
  ratio: number,
): ViewportScalePreset | null {
  const r = Math.round(ratio);
  return (ANNOTATION_SCALE_PRESETS as readonly number[]).includes(r)
    ? (r as ViewportScalePreset)
    : null;
}

/**
 * Convert a desired paper size (mm) → model world units at annotation scale 1:N.
 * Uses the same stored-scale convention as viewports (scaleFromRatio).
 */
export function modelSizeFromPaperMm(
  paperMm: number,
  annotationRatio: number,
): number {
  if (!(paperMm > 0) || !(annotationRatio > 0)) return 0;
  return paperMm * scaleFromRatio(annotationRatio);
}

/** Inverse: model world size → approximate paper millimetres at annotation scale. */
export function paperMmFromModelSize(
  modelSize: number,
  annotationRatio: number,
): number {
  if (!(modelSize > 0) || !(annotationRatio > 0)) return 0;
  return modelSize / scaleFromRatio(annotationRatio);
}

/**
 * Screen pixels for an annotative paper size inside a paper view / viewport.
 * `pxPerMm` comes from PaperViewTransform.
 */
export function annotativeScreenPx(
  paperMm: number,
  pxPerMm: number,
  minPx = 8,
): number {
  return Math.max(minPx, paperMm * pxPerMm);
}

/**
 * Effective paper millimetres for a model annotation entity.
 * Prefers explicit paperHeightMm; else derives from model size + annotation ratio.
 */
export function resolvePaperHeightMm(opts: {
  paperHeightMm?: number | null;
  modelHeight?: number | null;
  annotationRatio: number;
  fallbackPaperMm: number;
}): number {
  if (opts.paperHeightMm != null && opts.paperHeightMm > 0) {
    return opts.paperHeightMm;
  }
  if (opts.modelHeight != null && opts.modelHeight > 0) {
    return paperMmFromModelSize(opts.modelHeight, opts.annotationRatio);
  }
  return opts.fallbackPaperMm;
}

/** Whether an entity is treated as annotative (Model Space only). */
export function isAnnotativeEntity(entity: {
  metadata?: Record<string, unknown>;
  properties?: object;
}): boolean {
  if (entity.metadata?.paperSpace === true) return false;
  if (entity.metadata?.annotative === false) return false;
  if (entity.metadata?.annotative === true) return true;
  const props = entity.properties as { annotative?: boolean } | undefined;
  if (props?.annotative === false) return false;
  if (props?.annotative === true) return true;
  return false;
}

export function annotationScaleLabel(settings: AnnotationScaleSettings): string {
  return formatAnnotationScale(settings.ratio);
}

/** Length unit helper for UI — annotation paper sizes are always millimetres. */
export function annotationPaperUnitLabel(_world?: LengthUnit): string {
  return 'mm';
}
