import { describe, expect, it } from 'vitest';
import type { MTextBody, TextEntity } from '@ratecad/core';
import {
  applyStyleToRange,
  approximateMeasure,
  bodyFromPlain,
  deleteTextRange,
  fitTextWidthFactor,
  indexAtLocal,
  insertTextAt,
  layoutMText,
  plainTextFromBody,
  resizeMTextWidth,
  setBodyHeight,
  setParagraphAlign,
  splitParagraphAt,
  widthFromCorners,
} from './mtext.js';

function geometry(
  body: MTextBody,
  patch: Partial<TextEntity['geometry']> = {},
): TextEntity['geometry'] {
  return {
    position: { x: 0, y: 0 },
    content: plainTextFromBody(body),
    height: 10,
    rotation: 0,
    width: 80,
    attachment: 'TL',
    body,
    ...patch,
  };
}

describe('mtext layout', () => {
  it('builds two paragraphs and formats each line independently', () => {
    let body = bodyFromPlain('Bedroom\n12x15', 10);
    body = applyStyleToRange(body, 0, 7, { bold: true, fontFamily: 'Georgia' });
    body = applyStyleToRange(body, 8, 13, { italic: true });
    expect(plainTextFromBody(body)).toBe('Bedroom\n12x15');
    expect(body.paragraphs[0]?.spans[0]).toMatchObject({ text: 'Bedroom', bold: true, fontFamily: 'Georgia' });
    expect(body.paragraphs[1]?.spans[0]).toMatchObject({ text: '12x15', italic: true });
    const layout = layoutMText(geometry(body), '#fff');
    expect(layout?.runs.map((run) => run.text)).toEqual(['Bedroom', '12x15']);
    expect(layout?.runs[0]?.span.bold).toBe(true);
    expect(layout?.runs[1]?.span.italic).toBe(true);
    expect(layout?.runs[1]?.y).toBeLessThan(layout!.runs[0]!.y);
  });

  it('wraps when the box is narrower and keeps the font height', () => {
    const body = bodyFromPlain('Bedroom label', 10);
    const narrow = layoutMText(geometry(body, { width: 40 }), '#fff');
    const wide = layoutMText(geometry(body, { width: 200 }), '#fff');
    expect(narrow!.runs.length).toBeGreaterThan(1);
    expect(wide!.runs).toHaveLength(1);
    expect(narrow!.runs.every((run) => run.span.height === 10)).toBe(true);
    const resized = resizeMTextWidth(geometry(body, { width: 40 }), 200);
    expect(resized.width).toBe(200);
    expect(resized.body?.paragraphs[0]?.spans[0]?.height).toBe(10);
  });

  it('scales text height without moving the insertion point', () => {
    const body = setBodyHeight(bodyFromPlain('Bedroom\n12x15', 150), 150);
    const before = geometry(body, { height: 150, position: { x: 5, y: 8 } });
    const grown = {
      ...before,
      height: 200,
      body: setBodyHeight(body, 200),
    };
    const layout = layoutMText(grown, '#fff');
    expect(layout?.runs[0]?.span.height).toBe(200);
    expect(grown.position).toEqual(before.position);
    expect(layout!.runs[0]!.y - layout!.runs[1]!.y).toBeGreaterThan(150);
  });

  it('aligns a short line left, center, and right inside the same box', () => {
    const body = bodyFromPlain('Room', 10);
    const left = layoutMText(geometry(setParagraphAlign(body, 0, 'left')), '#fff');
    const center = layoutMText(geometry(setParagraphAlign(body, 0, 'center')), '#fff');
    const right = layoutMText(geometry(setParagraphAlign(body, 0, 'right')), '#fff');
    expect(center!.runs[0]!.x).toBeGreaterThan(left!.runs[0]!.x);
    expect(right!.runs[0]!.x).toBeGreaterThan(center!.runs[0]!.x);
    expect(left!.corners[0]).toEqual(center!.corners[0]);
  });

  it('keeps each attachment point on the insertion position', () => {
    const body = bodyFromPlain('Room', 10);
    const base = geometry(body, { position: { x: 20, y: 30 }, width: 40 });
    const attachments = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'] as const;
    for (const attachment of attachments) {
      const layout = layoutMText({ ...base, attachment }, '#fff')!;
      const column = attachment[1];
      const row = attachment[0];
      const index = row === 'T' ? (column === 'L' ? 0 : column === 'C' ? -1 : 1)
        : row === 'B' ? (column === 'L' ? 3 : column === 'R' ? 2 : -1)
          : -1;
      if (index >= 0) {
        expect(layout.corners[index]!.x).toBeCloseTo(20, 5);
        expect(layout.corners[index]!.y).toBeCloseTo(30, 5);
      } else if (attachment === 'MC') {
        const midX = (layout.corners[0].x + layout.corners[1].x) / 2;
        const midY = (layout.corners[0].y + layout.corners[3].y) / 2;
        expect(midX).toBeCloseTo(20, 5);
        expect(midY).toBeCloseTo(30, 5);
      }
    }
  });

  it('rotates the boundary by 45 degrees and fits width without changing the box', () => {
    const body = bodyFromPlain('Room', 10);
    const layout = layoutMText(
      geometry(body, { rotation: Math.PI / 4, position: { x: 0, y: 0 } }),
      '#fff',
    )!;
    expect(layout.corners[1].x).toBeGreaterThan(0);
    expect(layout.corners[1].y).toBeGreaterThan(0);
    const fitted = fitTextWidthFactor(geometry(body, { width: 100 }));
    expect(fitted?.paragraphs[0]?.spans[0]?.widthFactor).toBeGreaterThan(1);
    expect(geometry(body, { width: 100 }).width).toBe(100);
  });

  it('inserts, splits, and deletes without dropping the other line', () => {
    let body = bodyFromPlain('Bedroom', 10);
    body = splitParagraphAt(body, 7);
    body = insertTextAt(body, 8, '12x15');
    expect(plainTextFromBody(body)).toBe('Bedroom\n12x15');
    body = applyStyleToRange(body, 0, 7, { bold: true });
    body = deleteTextRange(body, 7, 8);
    expect(plainTextFromBody(body)).toBe('Bedroom12x15');
    expect(body.paragraphs[0]?.spans[0]?.bold).toBe(true);
    const layout = layoutMText(geometry(bodyFromPlain('Bedroom\n12x15', 10)), '#fff');
    expect(layout?.runs[1]?.sourceStart).toBe(8);
  });

  it('widens spaces on a wrapped justified line and leaves the last line', () => {
    const body = setParagraphAlign(bodyFromPlain('one two three four', 10), 0, 'justify');
    const layout = layoutMText(geometry(body, { width: 50 }), '#fff')!;
    const firstY = layout.runs[0]!.y;
    const first = layout.runs.filter((run) => Math.abs(run.y - firstY) < 1e-6);
    const words = first.filter((run) => run.text.trim());
    expect(words.length).toBeGreaterThan(1);
    const gap = words[1]!.x - (words[0]!.x + approximateMeasure(words[0]!.text, words[0]!.span));
    expect(gap).toBeGreaterThan(approximateMeasure(' ', words[0]!.span) + 1);
    expect(words[0]!.charGap).toBe(0);
    expect(words[0]!.width).toBeCloseTo(approximateMeasure(words[0]!.text, words[0]!.span));
    const last = layout.runs[layout.runs.length - 1]!;
    expect(last.x + last.width).toBeLessThan(48);
    const bold = applyStyleToRange(body, 0, 3, { bold: true });
    const mixed = layoutMText(geometry(bold, { width: 50 }), '#fff')!;
    expect(mixed.runs.find((run) => run.text === 'one')?.span.bold).toBe(true);
    expect(mixed.runs.find((run) => run.text === 'two')?.span.bold).toBe(false);
    const space = first.find((run) => run.text === ' ');
    expect(space).toBeTruthy();
    const hit = indexAtLocal(geometry(body, { width: 50 }), space!.x + space!.width - 0.2, 2);
    expect(hit).toBe(space!.sourceStart + space!.text.length);
  });

  it('derives the top-left boundary from two corners', () => {
    expect(widthFromCorners({ x: 0, y: 10 }, { x: 25, y: 0 })).toEqual({
      position: { x: 0, y: 10 },
      width: 25,
    });
    expect(widthFromCorners({ x: 1, y: 1 }, { x: 1, y: 4 })).toBeNull();
  });
});
