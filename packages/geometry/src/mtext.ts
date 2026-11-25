import type {
  MTextAlign,
  MTextAttachment,
  MTextBody,
  MTextParagraph,
  MTextSpan,
  TextEntity,
  Vec2,
} from '@ratecad/core';

export const MTEXT_FONTS = [
  'Arial',
  'Consolas',
  'Courier New',
  'Georgia',
  'Tahoma',
  'Times New Roman',
  'Verdana',
] as const;

export const MTEXT_DEFAULT_FONT = 'Arial';
export const MTEXT_HEIGHT_STEP = 0.25;

export const MTEXT_SYMBOLS = [
  { id: 'degree', label: 'Degree', value: '°' },
  { id: 'plusminus', label: 'Plus/Minus', value: '±' },
  { id: 'diameter', label: 'Diameter', value: 'Ø' },
  { id: 'sqm', label: 'Square meters', value: 'm²' },
] as const;

export const MTEXT_ATTACHMENTS: MTextAttachment[] = [
  'TL',
  'TC',
  'TR',
  'ML',
  'MC',
  'MR',
  'BL',
  'BC',
  'BR',
];

export interface ResolvedMTextSpan {
  text: string;
  fontFamily: string;
  height: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  overline: boolean;
  strikethrough: boolean;
  color: string;
  widthFactor: number;
  tracking: number;
  baseline: 'normal' | 'super' | 'sub';
}

export interface MTextRun {
  text: string;
  span: ResolvedMTextSpan;
  /** World position of the left end of the baseline. */
  x: number;
  y: number;
  /** Extra gap inserted after each character, in drawing units. Distribute uses this. Justify does not. */
  charGap: number;
  /** Laid-out advance in drawing units, including justified space but not character stretch. */
  width: number;
  /** Plain-text index of `text`, or -1 when the run is a generated list marker. */
  sourceStart: number;
}

export interface MTextLayout {
  runs: MTextRun[];
  width: number;
  height: number;
  /** Boundary corners in world space, starting at the top-left and going clockwise. */
  corners: [Vec2, Vec2, Vec2, Vec2];
}

export type MTextMeasure = (text: string, span: ResolvedMTextSpan) => number;

export function isMText(
  entity: TextEntity,
): entity is TextEntity & {
  geometry: TextEntity['geometry'] & { width: number; body: MTextBody };
} {
  return (
    typeof entity.geometry.width === 'number' &&
    entity.geometry.width > 0 &&
    !!entity.geometry.body &&
    entity.geometry.body.paragraphs.length > 0
  );
}

export function plainTextFromBody(body: MTextBody): string {
  return body.paragraphs
    .map((paragraph) => paragraph.spans.map((span) => span.text).join(''))
    .join('\n');
}

export function bodyFromPlain(text: string, height?: number): MTextBody {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const source = lines.length > 0 ? lines : [''];
  return {
    paragraphs: source.map((line) => ({
      align: 'left',
      lineSpacing: 1,
      spans: [{ text: line, ...(height ? { height } : {}) }],
    })),
  };
}

export function resolveSpan(
  span: MTextSpan,
  defaults: { height: number; color: string; fontFamily?: string },
): ResolvedMTextSpan {
  const height = span.height && span.height > 0 ? span.height : defaults.height;
  return {
    text: span.text,
    fontFamily: span.fontFamily || defaults.fontFamily || MTEXT_DEFAULT_FONT,
    height,
    bold: !!span.bold,
    italic: !!span.italic,
    underline: !!span.underline,
    overline: !!span.overline,
    strikethrough: !!span.strikethrough,
    color: span.color || defaults.color,
    widthFactor: span.widthFactor && span.widthFactor > 0 ? span.widthFactor : 1,
    tracking: span.tracking && Number.isFinite(span.tracking) ? span.tracking : 0,
    baseline: span.baseline ?? 'normal',
  };
}

/** Average Latin width used when a canvas measure is unavailable. */
export function approximateMeasure(text: string, span: ResolvedMTextSpan): number {
  if (!text) return 0;
  const drawn = span.baseline === 'normal' ? span.height : span.height * 0.6;
  const advance = drawn * 0.52 * span.widthFactor;
  return text.length * advance + Math.max(0, text.length - 1) * span.tracking;
}

function drawHeight(span: ResolvedMTextSpan): number {
  return span.baseline === 'normal' ? span.height : span.height * 0.6;
}

interface Token {
  text: string;
  span: ResolvedMTextSpan;
  kind: 'word' | 'space' | 'break' | 'tab';
  /** List markers are drawn but are not part of the stored paragraph text. */
  synthetic?: boolean;
}

function tokensOf(span: ResolvedMTextSpan): Token[] {
  const parts = span.text.split(/(\n|\t| +)/);
  const tokens: Token[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part === '\n') tokens.push({ text: '', span, kind: 'break' });
    else if (part === '\t') tokens.push({ text: '', span, kind: 'tab' });
    else if (/^ +$/.test(part)) tokens.push({ text: part, span, kind: 'space' });
    else tokens.push({ text: part, span, kind: 'word' });
  }
  return tokens;
}

interface LaidPiece {
  text: string;
  span: ResolvedMTextSpan;
  width: number;
  /** Plain-text index, or -1 for a list marker that is not stored in the body. */
  sourceStart: number;
}

interface LaidLine {
  pieces: LaidPiece[];
  width: number;
  height: number;
  indent: number;
  align: MTextAlign;
  spacing: number;
  hard: boolean;
}

function pieceWidth(piece: LaidPiece, measure: MTextMeasure): number {
  return measure(piece.text, piece.span);
}

function layoutParagraph(
  paragraph: MTextParagraph,
  boxWidth: number,
  defaults: { height: number; color: string; fontFamily?: string },
  measure: MTextMeasure,
  paragraphStart: number,
  listNumber: number,
): LaidLine[] {
  const align = paragraph.align ?? 'left';
  const spacing = paragraph.lineSpacing && paragraph.lineSpacing > 0 ? paragraph.lineSpacing : 1;
  const indent = paragraph.indent ?? 0;
  const firstIndent = paragraph.firstLineIndent ?? 0;
  const tabs = paragraph.tabs ?? [];
  const spans = paragraph.spans.length > 0 ? paragraph.spans : [{ text: '' }];
  const tokens = spans.flatMap((span) => tokensOf(resolveSpan(span, defaults)));
  if (paragraph.list === 'bullet') {
    tokens.unshift({
      text: '• ',
      span: resolveSpan({ text: '• ' }, defaults),
      kind: 'word',
      synthetic: true,
    });
  } else if (paragraph.list === 'number') {
    const label = `${listNumber}. `;
    tokens.unshift({
      text: label,
      span: resolveSpan({ text: label }, defaults),
      kind: 'word',
      synthetic: true,
    });
  }

  const lines: LaidLine[] = [];
  let pieces: LaidPiece[] = [];
  let width = indent + firstIndent;
  let height = defaults.height;
  let lineIndent = indent + firstIndent;
  let source = paragraphStart;

  const flush = (hard: boolean) => {
    lines.push({
      pieces,
      width: Math.max(0, width - lineIndent),
      height: Math.max(height, defaults.height * 0.2),
      indent: lineIndent,
      align,
      spacing,
      hard,
    });
    pieces = [];
    lineIndent = indent;
    width = indent;
    height = defaults.height;
  };

  for (const token of tokens) {
    if (token.kind === 'break') {
      if (!token.synthetic) source += 1;
      flush(true);
      continue;
    }
    if (token.kind === 'tab') {
      const next = tabs.find((stop) => stop > width + 1e-6);
      const target = next ?? width + token.span.height;
      const gap = Math.max(0, target - width);
      pieces.push({ text: '', span: token.span, width: gap, sourceStart: token.synthetic ? -1 : source });
      width += gap;
      if (!token.synthetic) source += 1;
      continue;
    }
    const tokenWidth = measure(token.text, token.span);
    if (
      token.kind === 'word' &&
      pieces.some((piece) => piece.text.trim()) &&
      width + tokenWidth > boxWidth + 1e-6 &&
      boxWidth > lineIndent
    ) {
      flush(false);
      width = lineIndent;
    }
    if (token.kind === 'space' && pieces.length === 0) {
      if (!token.synthetic) source += token.text.length;
      continue;
    }
    pieces.push({
      text: token.text,
      span: token.span,
      width: tokenWidth,
      sourceStart: token.synthetic ? -1 : source,
    });
    width += tokenWidth;
    height = Math.max(height, token.span.height);
    if (!token.synthetic) source += token.text.length;
  }
  if (pieces.length > 0 || lines.length === 0) flush(true);
  return lines;
}

function placeLine(line: LaidLine, boxWidth: number): Array<LaidPiece & { gap: number }> {
  const content = line.width;
  const gaps = line.pieces.filter((piece) => piece.text === '' || /^ +$/.test(piece.text)).length;
  const chars = line.pieces.reduce((sum, piece) => sum + Math.max(piece.text.length, 1), 0);
  let extra = 0;
  if (line.align === 'justify' && !line.hard && gaps > 0) {
    extra = Math.max(0, boxWidth - line.indent - content);
  }
  if (line.align === 'distribute' && chars > 1) {
    extra = Math.max(0, boxWidth - line.indent - content);
  }
  const spaceExtra = line.align === 'justify' && gaps > 0 ? extra / gaps : 0;
  const charExtra = line.align === 'distribute' && chars > 1 ? extra / (chars - 1) : 0;
  return line.pieces.map((piece) => ({
    ...piece,
    width:
      piece.width +
      ((piece.text === '' || /^ +$/.test(piece.text)) && line.align === 'justify'
        ? spaceExtra
        : 0),
    gap: line.align === 'distribute' ? charExtra : 0,
  }));
}

function lineStart(align: MTextAlign, indent: number, content: number, boxWidth: number): number {
  if (align === 'center') return Math.max(0, (boxWidth - content) / 2);
  if (align === 'right') return Math.max(0, boxWidth - content);
  return indent;
}

export function attachmentOffset(
  attachment: MTextAttachment,
  width: number,
  height: number,
): { x: number; y: number } {
  const column = attachment[1];
  const row = attachment[0];
  const x = column === 'L' ? 0 : column === 'C' ? width / 2 : width;
  const y = row === 'T' ? 0 : row === 'M' ? height / 2 : height;
  return { x, y };
}

export function mtextLocalToWorld(
  localX: number,
  localYDown: number,
  position: Vec2,
  rotation: number,
  anchor: { x: number; y: number },
): Vec2 {
  const dx = localX - anchor.x;
  const dy = -(localYDown - anchor.y);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: position.x + dx * cos - dy * sin,
    y: position.y + dx * sin + dy * cos,
  };
}

export function layoutMText(
  geometry: TextEntity['geometry'],
  color: string,
  measure: MTextMeasure = approximateMeasure,
): MTextLayout | null {
  const width = geometry.width;
  const body = geometry.body;
  if (!(width && width > 0) || !body || body.paragraphs.length === 0) return null;
  const defaults = {
    height: geometry.height,
    color,
    fontFamily: MTEXT_DEFAULT_FONT,
  };
  const paragraphStarts: number[] = [];
  let plainCursor = 0;
  body.paragraphs.forEach((paragraph) => {
    paragraphStarts.push(plainCursor);
    plainCursor += paragraph.spans.reduce((sum, span) => sum + span.text.length, 0) + 1;
  });
  let listNumber = 0;
  const paragraphs = body.paragraphs.map((paragraph, index) => {
    if (paragraph.list === 'number') listNumber += 1;
    return layoutParagraph(
      paragraph,
      width,
      defaults,
      measure,
      paragraphStarts[index] ?? 0,
      paragraph.list === 'number' ? listNumber : 0,
    );
  });
  const runs: MTextRun[] = [];
  let cursor = 0;
  paragraphs.forEach((lines, paragraphIndex) => {
    const paragraph = body.paragraphs[paragraphIndex]!;
    cursor += paragraph.spaceBefore ?? 0;
    lines.forEach((line, lineIndex) => {
      const placed = placeLine(line, width);
      const content = placed.reduce((sum, piece) => sum + piece.width, 0);
      let x = lineStart(line.align, line.indent, content, width);
      if (lineIndex === 0) x += 0;
      const lineHeight = line.height * line.spacing;
      const baseline = cursor + lineHeight * 0.8;
      let pending: {
        text: string;
        span: ResolvedMTextSpan;
        x: number;
        gap: number;
        sourceStart: number;
        width: number;
      } | null = null;
      const naturalAdvance = (text: string, span: ResolvedMTextSpan, gap: number) =>
        measure(text, span) + gap * Math.max(0, text.length - 1);
      const flushPending = () => {
        if (!pending) return;
        const world = mtextLocalToWorld(
          pending.x,
          baseline,
          geometry.position,
          geometry.rotation,
          { x: 0, y: 0 },
        );
        runs.push({
          text: pending.text,
          span: pending.span,
          x: world.x,
          y: world.y,
          charGap: pending.gap,
          sourceStart: pending.sourceStart,
          width: pending.width,
        });
        pending = null;
      };
      for (const piece of placed) {
        const pieceAdvance = piece.width + piece.gap * Math.max(0, piece.text.length - 1);
        if (piece.text) {
          const piecePadded = pieceAdvance > naturalAdvance(piece.text, piece.span, piece.gap) + 1e-6;
          const pendingPadded =
            pending != null &&
            pending.width > naturalAdvance(pending.text, pending.span, pending.gap) + 1e-6;
          const same =
            pending &&
            !piecePadded &&
            !pendingPadded &&
            pending.span === piece.span &&
            pending.gap === piece.gap &&
            pending.sourceStart >= 0 &&
            piece.sourceStart === pending.sourceStart + pending.text.length;
          if (same && pending) {
            pending.text += piece.text;
            pending.width += pieceAdvance;
          } else {
            flushPending();
            pending = {
              text: piece.text,
              span: piece.span,
              x,
              gap: piece.gap,
              sourceStart: piece.sourceStart,
              width: pieceAdvance,
            };
          }
        }
        x += pieceAdvance;
      }
      flushPending();
      cursor += lineHeight;
    });
    cursor += paragraph.spaceAfter ?? 0;
  });
  const boxHeight = Math.max(cursor, geometry.height);
  const anchor = attachmentOffset(geometry.attachment ?? 'TL', width, boxHeight);
  const shifted = runs.map((run) => {
    const local = worldToLocalUnanchored(run, geometry);
    const world = mtextLocalToWorld(
      local.x,
      local.y,
      geometry.position,
      geometry.rotation,
      anchor,
    );
    return { ...run, x: world.x, y: world.y };
  });
  const corners = [0, 1, 2, 3].map((index) => {
    const localX = index === 0 || index === 3 ? 0 : width;
    const localY = index === 0 || index === 1 ? 0 : boxHeight;
    return mtextLocalToWorld(localX, localY, geometry.position, geometry.rotation, anchor);
  }) as [Vec2, Vec2, Vec2, Vec2];
  return { runs: shifted, width, height: boxHeight, corners };
}

function worldToLocalUnanchored(run: MTextRun, geometry: TextEntity['geometry']): Vec2 {
  const dx = run.x - geometry.position.x;
  const dy = run.y - geometry.position.y;
  const cos = Math.cos(-geometry.rotation);
  const sin = Math.sin(-geometry.rotation);
  const localX = dx * cos - dy * sin;
  const localYUp = dx * sin + dy * cos;
  return { x: localX, y: -localYUp };
}

export function mtextBounds(layout: MTextLayout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = layout.corners[0].x;
  let minY = layout.corners[0].y;
  let maxX = layout.corners[0].x;
  let maxY = layout.corners[0].y;
  for (const corner of layout.corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInMText(
  point: Vec2,
  geometry: TextEntity['geometry'],
  tolerance = 0,
): boolean {
  const layout = layoutMText(geometry, '#fff');
  if (!layout) return false;
  const anchor = attachmentOffset(
    geometry.attachment ?? 'TL',
    layout.width,
    layout.height,
  );
  const dx = point.x - geometry.position.x;
  const dy = point.y - geometry.position.y;
  const cos = Math.cos(-geometry.rotation);
  const sin = Math.sin(-geometry.rotation);
  const localX = dx * cos - dy * sin + anchor.x;
  const localY = -(dx * sin + dy * cos) + anchor.y;
  return (
    localX >= -tolerance &&
    localX <= layout.width + tolerance &&
    localY >= -tolerance &&
    localY <= layout.height + tolerance
  );
}

export function scaleMTextGeometry(
  geometry: TextEntity['geometry'],
  factor: number,
  position: Vec2,
): TextEntity['geometry'] {
  const next: TextEntity['geometry'] = {
    ...geometry,
    position,
    height: geometry.height * factor,
    ...(geometry.width ? { width: geometry.width * factor } : {}),
  };
  if (geometry.body) {
    next.body = scaleBody(geometry.body, factor);
  }
  return next;
}

export function scaleBody(body: MTextBody, factor: number): MTextBody {
  return {
    paragraphs: body.paragraphs.map((paragraph) => ({
      ...paragraph,
      spaceBefore: (paragraph.spaceBefore ?? 0) * factor,
      spaceAfter: (paragraph.spaceAfter ?? 0) * factor,
      indent: (paragraph.indent ?? 0) * factor,
      firstLineIndent: (paragraph.firstLineIndent ?? 0) * factor,
      tabs: paragraph.tabs?.map((stop) => stop * factor),
      spans: paragraph.spans.map((span) => ({
        ...span,
        ...(span.height ? { height: span.height * factor } : {}),
        ...(span.tracking ? { tracking: span.tracking * factor } : {}),
      })),
    })),
  };
}

export function setBodyHeight(body: MTextBody, height: number): MTextBody {
  return {
    paragraphs: body.paragraphs.map((paragraph) => ({
      ...paragraph,
      spans: paragraph.spans.map((span) => ({ ...span, height })),
    })),
  };
}

/** Apply a style to a plain-text character range. Indexes match `plainTextFromBody`, including newlines. */
export function applyStyleToRange(
  body: MTextBody,
  start: number,
  end: number,
  patch: Partial<MTextSpan>,
): MTextBody {
  let cursor = 0;
  return {
    paragraphs: body.paragraphs.map((paragraph) => {
      const spans = paragraph.spans.flatMap((span) => {
        const spanStart = cursor;
        const spanEnd = cursor + span.text.length;
        cursor = spanEnd;
        if (end <= spanStart || start >= spanEnd || !span.text) return [span];
        const localStart = Math.max(0, start - spanStart);
        const localEnd = Math.min(span.text.length, end - spanStart);
        const parts: MTextSpan[] = [];
        if (localStart > 0) parts.push({ ...span, text: span.text.slice(0, localStart) });
        parts.push({ ...span, ...patch, text: span.text.slice(localStart, localEnd) });
        if (localEnd < span.text.length) {
          parts.push({ ...span, text: span.text.slice(localEnd) });
        }
        return parts.filter((part) => part.text.length > 0);
      });
      cursor += 1;
      return { ...paragraph, spans };
    }),
  };
}

export function setParagraphAlign(body: MTextBody, index: number, align: MTextAlign): MTextBody {
  return {
    paragraphs: body.paragraphs.map((paragraph, paragraphIndex) =>
      paragraphIndex === index ? { ...paragraph, align } : paragraph,
    ),
  };
}

export function setAttachment(
  geometry: TextEntity['geometry'],
  attachment: MTextAttachment,
): TextEntity['geometry'] {
  return { ...geometry, attachment };
}

/** New box width from a drag on the right edge. Height and character width stay unchanged. */
export function widthFromRightGrip(geometry: TextEntity['geometry'], point: Vec2): number {
  const layout = layoutMText(geometry, '#fff');
  const minimum = Math.max(geometry.height * 0.25, 0.01);
  if (!layout) return geometry.width ?? minimum;
  const origin = layout.corners[0]!;
  const edge = layout.corners[1]!;
  const axisX = edge.x - origin.x;
  const axisY = edge.y - origin.y;
  const length = Math.hypot(axisX, axisY);
  if (length <= 1e-9) return geometry.width ?? minimum;
  const along = ((point.x - origin.x) * axisX + (point.y - origin.y) * axisY) / length;
  return Math.max(minimum, along);
}

export function widthFromCorners(first: Vec2, second: Vec2): {
  position: Vec2;
  width: number;
} | null {
  const width = Math.abs(second.x - first.x);
  if (!(width > 1e-9)) return null;
  return {
    position: { x: Math.min(first.x, second.x), y: Math.max(first.y, second.y) },
    width,
  };
}

/** Change width factor so the longest line fills the boundary. Box width stays put. */
export function fitTextWidthFactor(
  geometry: TextEntity['geometry'],
  measure: MTextMeasure = approximateMeasure,
): MTextBody | null {
  if (!geometry.body || !(geometry.width && geometry.width > 0)) return null;
  const layout = layoutMText({ ...geometry, rotation: 0, attachment: 'TL' }, '#fff', measure);
  if (!layout) return null;
  const longest = layout.runs.reduce((max, run) => {
    const width = measure(run.text, run.span) + run.charGap * Math.max(0, run.text.length - 1);
    return Math.max(max, width);
  }, 0);
  if (!(longest > 1e-9)) return geometry.body;
  const factor = geometry.width / longest;
  return {
    paragraphs: geometry.body.paragraphs.map((paragraph) => ({
      ...paragraph,
      spans: paragraph.spans.map((span) => ({
        ...span,
        widthFactor: (span.widthFactor && span.widthFactor > 0 ? span.widthFactor : 1) * factor,
      })),
    })),
  };
}

export function resizeMTextWidth(
  geometry: TextEntity['geometry'],
  width: number,
): TextEntity['geometry'] {
  return { ...geometry, width: Math.max(width, geometry.height * 0.25) };
}

export interface MTextCaret {
  paragraph: number;
  span: number;
  offset: number;
  index: number;
}

export function caretFromIndex(body: MTextBody, index: number): MTextCaret {
  const clamped = Math.max(0, index);
  let cursor = 0;
  for (let paragraphIndex = 0; paragraphIndex < body.paragraphs.length; paragraphIndex += 1) {
    const paragraph = body.paragraphs[paragraphIndex]!;
    const spans = paragraph.spans.length > 0 ? paragraph.spans : [{ text: '' }];
    for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
      const span = spans[spanIndex]!;
      if (clamped <= cursor + span.text.length) {
        return {
          paragraph: paragraphIndex,
          span: spanIndex,
          offset: clamped - cursor,
          index: clamped,
        };
      }
      cursor += span.text.length;
    }
    if (paragraphIndex < body.paragraphs.length - 1) {
      if (clamped === cursor) {
        const last = spans.length - 1;
        return {
          paragraph: paragraphIndex,
          span: last,
          offset: spans[last]!.text.length,
          index: clamped,
        };
      }
      cursor += 1;
    }
  }
  const paragraph = Math.max(0, body.paragraphs.length - 1);
  const spans = body.paragraphs[paragraph]?.spans ?? [{ text: '' }];
  const span = Math.max(0, spans.length - 1);
  return { paragraph, span, offset: spans[span]?.text.length ?? 0, index: cursor };
}

function styleAgrees(span: MTextSpan, patch: Partial<MTextSpan>): boolean {
  return (Object.keys(patch) as (keyof MTextSpan)[]).every((key) => {
    if (key === 'text') return true;
    return span[key] === patch[key];
  });
}

export function insertTextAt(
  body: MTextBody,
  index: number,
  text: string,
  style?: Partial<MTextSpan>,
): MTextBody {
  if (!text) return body;
  if (text.includes('\n')) {
    const parts = text.split('\n');
    let next = body;
    let at = index;
    parts.forEach((part, partIndex) => {
      if (part) {
        next = insertTextAt(next, at, part, style);
        at += part.length;
      }
      if (partIndex < parts.length - 1) {
        next = splitParagraphAt(next, at);
        at += 1;
      }
    });
    return next;
  }
  const loc = caretFromIndex(body, index);
  return {
    paragraphs: body.paragraphs.map((paragraph, paragraphIndex) => {
      if (paragraphIndex !== loc.paragraph) return paragraph;
      const spans = (paragraph.spans.length > 0 ? paragraph.spans : [{ text: '' }]).flatMap(
        (span, spanIndex) => {
          if (spanIndex !== loc.span) return [span];
          const before = span.text.slice(0, loc.offset);
          const after = span.text.slice(loc.offset);
          if (!style || styleAgrees(span, style)) {
            return [{ ...span, text: before + text + after }];
          }
          const parts: MTextSpan[] = [];
          if (before) parts.push({ ...span, text: before });
          parts.push({ ...span, ...style, text });
          if (after) parts.push({ ...span, text: after });
          return parts;
        },
      );
      return { ...paragraph, spans };
    }),
  };
}

export function splitParagraphAt(body: MTextBody, index: number): MTextBody {
  const loc = caretFromIndex(body, index);
  const paragraphs: MTextParagraph[] = [];
  body.paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex !== loc.paragraph) {
      paragraphs.push(paragraph);
      return;
    }
    const spans = paragraph.spans.length > 0 ? paragraph.spans : [{ text: '' }];
    const left: MTextSpan[] = [];
    const right: MTextSpan[] = [];
    spans.forEach((span, spanIndex) => {
      if (spanIndex < loc.span) left.push(span);
      else if (spanIndex > loc.span) right.push(span);
      else {
        const before = span.text.slice(0, loc.offset);
        const after = span.text.slice(loc.offset);
        if (before || left.length === 0) left.push({ ...span, text: before });
        if (after || right.length === 0) right.push({ ...span, text: after });
      }
    });
    paragraphs.push({ ...paragraph, spans: left.length > 0 ? left : [{ text: '' }] });
    paragraphs.push({
      ...paragraph,
      spans: right.length > 0 ? right : [{ text: '' }],
    });
  });
  return { paragraphs };
}

export function deleteTextRange(body: MTextBody, start: number, end: number): MTextBody {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  if (to <= from) return body;
  const paragraphs: MTextParagraph[] = [];
  let current: MTextParagraph | null = null;
  let cursor = 0;
  const push = (template: MTextParagraph, span: MTextSpan) => {
    if (!span.text) return;
    if (!current) {
      current = { ...template, spans: [] };
      paragraphs.push(current);
    }
    const last = current.spans[current.spans.length - 1];
    if (last && styleAgrees(last, span) && styleAgrees(span, last)) last.text += span.text;
    else current.spans.push({ ...span });
  };
  body.paragraphs.forEach((paragraph, paragraphIndex) => {
    paragraph.spans.forEach((span) => {
      let kept = '';
      for (const character of span.text) {
        if (cursor < from || cursor >= to) kept += character;
        cursor += 1;
      }
      if (kept) push(paragraph, { ...span, text: kept });
    });
    if (paragraphIndex < body.paragraphs.length - 1) {
      const newlineKept = cursor < from || cursor >= to;
      cursor += 1;
      if (newlineKept) {
        if (!current) {
          current = { ...paragraph, spans: [{ text: '' }] };
          paragraphs.push(current);
        }
        current = null;
      }
    }
  });
  if (paragraphs.length === 0) return bodyFromPlain('');
  return {
    paragraphs: paragraphs.map((paragraph) => ({
      ...paragraph,
      spans: paragraph.spans.length > 0 ? paragraph.spans : [{ text: '' }],
    })),
  };
}

/** Hit-test a point inside the unrotated text box. Y grows downward. */
export function indexAtLocal(
  geometry: TextEntity['geometry'],
  localX: number,
  localYDown: number,
  measure: MTextMeasure = approximateMeasure,
): number {
  const layout = layoutMText(
    { ...geometry, position: { x: 0, y: 0 }, rotation: 0, attachment: 'TL' },
    '#fff',
    measure,
  );
  const length = geometry.body ? plainTextFromBody(geometry.body).length : 0;
  if (!layout) return 0;
  for (const run of layout.runs) {
    if (run.sourceStart < 0) continue;
    const baseline = -run.y;
    const top = baseline - run.span.height;
    const bottom = baseline + run.span.height * 0.3;
    const natural =
      measure(run.text, run.span) + run.charGap * Math.max(0, run.text.length - 1);
    const runWidth = Math.max(run.width, natural);
    if (localYDown < top || localYDown > bottom) continue;
    if (localX < run.x - 0.01 || localX > run.x + runWidth + 0.5) continue;
    let x = run.x;
    let index = run.sourceStart;
    for (const character of run.text) {
      const advance = measure(character, run.span) + run.charGap;
      if (localX <= x + advance / 2) return index;
      x += advance;
      index += 1;
    }
    return index;
  }
  let best = length;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const run of layout.runs) {
    if (run.sourceStart < 0) continue;
    const baseline = -run.y;
    const score = Math.abs(localYDown - baseline) * 8 + Math.abs(localX - run.x);
    if (score < bestScore) {
      bestScore = score;
      const runWidth = measure(run.text, run.span);
      best = localX > run.x + runWidth / 2 ? run.sourceStart + run.text.length : run.sourceStart;
    }
  }
  return best;
}
