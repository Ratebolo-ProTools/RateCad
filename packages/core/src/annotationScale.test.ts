import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANNOTATION_SCALE,
  annotativeDimensionCreate,
  annotativeTextCreate,
  formatAnnotationScale,
  isAnnotativeEntity,
  modelSizeFromPaperMm,
  paperMmFromModelSize,
  resolveAnnotationSettings,
  resolvePaperHeightMm,
  scaleFromRatio,
} from './index.js';

describe('annotation scale foundation', () => {
  it('converts paper mm ↔ model size via annotation ratio', () => {
    const ratio = 100;
    const paperMm = 2.5;
    const model = modelSizeFromPaperMm(paperMm, ratio);
    expect(model).toBeCloseTo(paperMm * scaleFromRatio(ratio), 10);
    expect(paperMmFromModelSize(model, ratio)).toBeCloseTo(paperMm, 10);
  });

  it('supports common architectural scales', () => {
    for (const n of [20, 25, 50, 75, 100, 150, 200, 250, 500]) {
      expect(formatAnnotationScale(n)).toBe(`1:${n}`);
      expect(modelSizeFromPaperMm(2.5, n)).toBeGreaterThan(0);
    }
  });

  it('viewport scale relationship: same paper size at matching VP scale', () => {
    const paperMm = 2.5;
    const ratio = 50;
    const modelH = modelSizeFromPaperMm(paperMm, ratio);
    const vpScale = scaleFromRatio(ratio);
    // screen ≈ modelH * (pxPerPaper / vpScale) = paperMm * pxPerPaper
    const pxPerPaper = 4;
    const screen = modelH * (pxPerPaper / vpScale);
    expect(screen).toBeCloseTo(paperMm * pxPerPaper, 8);
  });

  it('annotative text create stamps metadata without changing paper semantics', () => {
    const ann = resolveAnnotationSettings({
      ...DEFAULT_ANNOTATION_SCALE,
      ratio: 100,
      paperTextHeightMm: 2.5,
    });
    const created = annotativeTextCreate(ann);
    expect(created.metadata.annotative).toBe(true);
    expect(created.metadata.paperHeightMm).toBe(2.5);
    expect(created.height).toBeCloseTo(modelSizeFromPaperMm(2.5, 100), 10);
    expect(
      isAnnotativeEntity({
        metadata: created.metadata,
      }),
    ).toBe(true);
  });

  it('paper annotations are never annotative', () => {
    expect(
      isAnnotativeEntity({
        metadata: { paperSpace: true, annotative: true },
        properties: { annotative: true },
      }),
    ).toBe(false);
  });

  it('dimension create uses paper dim/arrow sizes', () => {
    const created = annotativeDimensionCreate({
      ...DEFAULT_ANNOTATION_SCALE,
      ratio: 50,
      paperDimTextHeightMm: 2.5,
      paperArrowSizeMm: 2,
    });
    expect(created.properties.textHeight).toBeCloseTo(
      modelSizeFromPaperMm(2.5, 50),
      10,
    );
    expect(created.properties.arrowSize).toBeCloseTo(
      modelSizeFromPaperMm(2, 50),
      10,
    );
  });

  it('resolvePaperHeightMm prefers explicit paper size', () => {
    expect(
      resolvePaperHeightMm({
        paperHeightMm: 3,
        modelHeight: 99,
        annotationRatio: 50,
        fallbackPaperMm: 2.5,
      }),
    ).toBe(3);
  });
});
