import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MTextAlign, MTextAttachment, MTextBody, MTextSpan, Vec2 } from '@ratecad/core';
import {
  MTEXT_ATTACHMENTS,
  MTEXT_FONTS,
  MTEXT_HEIGHT_STEP,
  MTEXT_SYMBOLS,
  applyStyleToRange,
  approximateMeasure,
  caretFromIndex,
  deleteTextRange,
  fitTextWidthFactor,
  indexAtLocal,
  insertTextAt,
  layoutMText,
  plainTextFromBody,
  resizeMTextWidth,
  setBodyHeight,
  setParagraphAlign,
  type MTextMeasure,
} from '@ratecad/geometry';
import {
  measureMTextText,
  mtextFaceAvailable,
  mtextFontCss,
  worldToScreen,
  type Camera,
} from '@ratecad/viewport';
import { mtextEditorClaimsKey } from './mtextKeyboard';

type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault: () => void;
  stopPropagation: () => void;
};

export interface MTextSession {
  mode: 'create' | 'edit';
  entityId?: string;
  position: Vec2;
  width: number;
  height: number;
  rotation: number;
  attachment: MTextAttachment;
  body: MTextBody;
  color: string;
}

interface MTextEditorProps {
  session: MTextSession;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  onFinish: (session: MTextSession) => void;
  onCancel: () => void;
}

interface Snapshot {
  body: MTextBody;
  height: number;
  caret: number;
  anchor: number;
}

const ATTACHMENT_LABEL: Record<MTextAttachment, string> = {
  TL: 'Top left',
  TC: 'Top center',
  TR: 'Top right',
  ML: 'Middle left',
  MC: 'Middle center',
  MR: 'Middle right',
  BL: 'Bottom left',
  BC: 'Bottom center',
  BR: 'Bottom right',
};

function cloneBody(body: MTextBody): MTextBody {
  return structuredClone(body);
}

export function MTextEditor({
  session,
  camera,
  canvasWidth,
  canvasHeight,
  onFinish,
  onCancel,
}: MTextEditorProps) {
  const [body, setBody] = useState<MTextBody>(() => cloneBody(session.body));
  const [height, setHeight] = useState(session.height);
  const [width, setWidth] = useState(session.width);
  const [rotation, setRotation] = useState(session.rotation);
  const [attachment, setAttachment] = useState<MTextAttachment>(session.attachment);
  const [caret, setCaret] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const [pending, setPending] = useState<Partial<MTextSpan>>({});
  const [step, setStep] = useState(() =>
    session.height >= 10 ? Math.max(1, Math.round(session.height / 10)) : MTEXT_HEIGHT_STEP,
  );
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef(false);
  const measureCanvas = useRef<HTMLCanvasElement | null>(null);
  if (!measureCanvas.current && typeof document !== 'undefined') {
    measureCanvas.current = document.createElement('canvas');
  }

  const measure: MTextMeasure = (text, span) => {
    const ctx = measureCanvas.current?.getContext('2d');
    if (!ctx || !(camera.zoom > 0)) return approximateMeasure(text, span);
    return measureMTextText(ctx, text, span, camera.zoom);
  };

  const draft = useMemo<MTextSession>(
    () => ({
      ...session,
      body,
      height,
      width,
      rotation,
      attachment,
    }),
    [session, body, height, width, rotation, attachment],
  );

  const geometry = useMemo(
    () => ({
      position: { x: 0, y: 0 },
      content: plainTextFromBody(body),
      height,
      rotation: 0,
      width,
      attachment: 'TL' as const,
      body,
    }),
    [body, height, width],
  );

  const localLayout = layoutMText(geometry, draft.color, measure);
  const worldLayout = layoutMText(
    { ...geometry, rotation, attachment, position: draft.position },
    draft.color,
    measure,
  );
  const plain = geometry.content;
  const selectedStart = Math.min(anchor, caret);
  const selectedEnd = Math.max(anchor, caret);

  useLayoutEffect(() => {
    const focusEditor = () => inputRef.current?.focus({ preventScroll: true });
    focusEditor();
    const frame = requestAnimationFrame(focusEditor);
    return () => cancelAnimationFrame(frame);
  }, []);

  const onKeyDownRef = useRef<(event: KeyEventLike) => void>(() => undefined);

  const remember = () => {
    undoRef.current.push({ body: cloneBody(body), height, caret, anchor });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
  };

  const commitBody = (next: MTextBody, nextCaret: number, nextHeight = height) => {
    remember();
    setBody(next);
    setHeight(nextHeight);
    setCaret(nextCaret);
    setAnchor(nextCaret);
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push({ body: cloneBody(body), height, caret, anchor });
    setBody(previous.body);
    setHeight(previous.height);
    setCaret(previous.caret);
    setAnchor(previous.anchor);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push({ body: cloneBody(body), height, caret, anchor });
    setBody(next.body);
    setHeight(next.height);
    setCaret(next.caret);
    setAnchor(next.anchor);
  };

  const insert = (text: string) => {
    if (!text) return;
    const start = Math.min(anchor, caret);
    const end = Math.max(anchor, caret);
    const cleared = start === end ? body : deleteTextRange(body, start, end);
    const styled = insertTextAt(cleared, start, text, pending);
    commitBody(styled, start + text.length);
  };

  const applyRange = (patch: Partial<MTextSpan>, entireWhenCollapsed: boolean) => {
    const start = Math.min(anchor, caret);
    const end = Math.max(anchor, caret);
    if (start === end) {
      if (!entireWhenCollapsed) {
        setPending((current) => ({ ...current, ...patch }));
        return;
      }
      const next = applyStyleToRange(body, 0, plain.length, patch);
      const nextHeight = patch.height && patch.height > 0 ? patch.height : height;
      commitBody(patch.height ? setBodyHeight(next, nextHeight) : next, caret, nextHeight);
      return;
    }
    commitBody(applyStyleToRange(body, start, end, patch), end);
    setAnchor(start);
    setCaret(end);
  };

  const toggleFlag = (flag: 'bold' | 'italic' | 'underline' | 'overline' | 'strikethrough') => {
    const loc = caretFromIndex(body, caret);
    const span = body.paragraphs[loc.paragraph]?.spans[loc.span];
    applyRange({ [flag]: !span?.[flag] }, false);
  };

  const changeHeight = (nextHeight: number) => {
    const value = Math.max(0.01, nextHeight);
    if (anchor !== caret) {
      applyRange({ height: value }, false);
      return;
    }
    remember();
    setBody(setBodyHeight(body, value));
    setHeight(value);
  };

  const alignParagraphs = (align: MTextAlign) => {
    const from = caretFromIndex(body, selectedStart).paragraph;
    const to = caretFromIndex(body, selectedEnd).paragraph;
    let next = body;
    for (let index = from; index <= to; index += 1) {
      next = setParagraphAlign(next, index, align);
    }
    commitBody(next, caret);
    setAnchor(anchor);
  };

  const patchParagraphs = (patch: Partial<MTextBody['paragraphs'][number]>) => {
    const from = caretFromIndex(body, selectedStart).paragraph;
    const to = caretFromIndex(body, selectedEnd).paragraph;
    const next: MTextBody = {
      paragraphs: body.paragraphs.map((paragraph, index) =>
        index >= from && index <= to ? { ...paragraph, ...patch } : paragraph,
      ),
    };
    commitBody(next, caret);
    setAnchor(anchor);
  };

  const finish = () => {
    if (!plainTextFromBody(body).trim()) {
      onCancel();
      return;
    }
    onFinish({ ...draft, body, height, width, rotation, attachment });
  };

  const localFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!worldLayout) return { x: 0, y: 0 };
    const parent = event.currentTarget.offsetParent as HTMLElement | null;
    const rect = (parent ?? event.currentTarget).getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const boxOrigin = worldToScreen(worldLayout.corners[0], camera, canvasWidth, canvasHeight);
    const edge = worldToScreen(worldLayout.corners[1], camera, canvasWidth, canvasHeight);
    const angle = Math.atan2(edge.y - boxOrigin.y, edge.x - boxOrigin.x);
    const dx = sx - boxOrigin.x;
    const dy = sy - boxOrigin.y;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const zoom = camera.zoom > 0 ? camera.zoom : 1;
    return {
      x: (dx * cos - dy * sin) / zoom,
      y: (dx * sin + dy * cos) / zoom,
    };
  };

  const onKeyDown = (event: KeyEventLike) => {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (meta && key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (meta && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (meta && key.toLowerCase() === 'a') {
      event.preventDefault();
      setAnchor(0);
      setCaret(plain.length);
      return;
    }
    if (meta && key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleFlag('bold');
      return;
    }
    if (meta && key.toLowerCase() === 'i') {
      event.preventDefault();
      toggleFlag('italic');
      return;
    }
    if (meta && key.toLowerCase() === 'u') {
      event.preventDefault();
      toggleFlag('underline');
      return;
    }
    if (meta && key.toLowerCase() === 'c' && selectedStart !== selectedEnd) {
      event.preventDefault();
      void navigator.clipboard?.writeText(plain.slice(selectedStart, selectedEnd));
      return;
    }
    if (meta && key.toLowerCase() === 'v') {
      event.preventDefault();
      void navigator.clipboard?.readText().then((text) => {
        if (text) insert(text.replace(/\r\n/g, '\n'));
      });
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      if (anchor !== caret) commitBody(deleteTextRange(body, selectedStart, selectedEnd), selectedStart);
      else if (caret > 0) commitBody(deleteTextRange(body, caret - 1, caret), caret - 1);
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      if (anchor !== caret) commitBody(deleteTextRange(body, selectedStart, selectedEnd), selectedStart);
      else if (caret < plain.length) commitBody(deleteTextRange(body, caret, caret + 1), caret);
      return;
    }
    if (key === 'Tab') {
      event.preventDefault();
      insert('\t');
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      insert('\n');
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      const next = Math.max(0, caret - 1);
      setCaret(next);
      if (!event.shiftKey) setAnchor(next);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      const next = Math.min(plain.length, caret + 1);
      setCaret(next);
      if (!event.shiftKey) setAnchor(next);
      return;
    }
    if (key === 'Home' || key === 'ArrowUp') {
      event.preventDefault();
      const paragraph = caretFromIndex(body, caret).paragraph;
      const target = key === 'ArrowUp' ? Math.max(0, paragraph - 1) : paragraph;
      let index = 0;
      for (let i = 0; i < target; i += 1) {
        index += body.paragraphs[i]!.spans.reduce((sum, span) => sum + span.text.length, 0) + 1;
      }
      setCaret(index);
      if (!event.shiftKey) setAnchor(index);
      return;
    }
    if (key === 'End' || key === 'ArrowDown') {
      event.preventDefault();
      const paragraph = caretFromIndex(body, caret).paragraph;
      const target = key === 'ArrowDown' ? Math.min(body.paragraphs.length - 1, paragraph + 1) : paragraph;
      let index = 0;
      for (let i = 0; i <= target; i += 1) {
        index += body.paragraphs[i]!.spans.reduce((sum, span) => sum + span.text.length, 0);
        if (i < target) index += 1;
      }
      setCaret(index);
      if (!event.shiftKey) setAnchor(index);
      return;
    }
    if (key.length === 1 && !meta && !event.altKey) {
      event.preventDefault();
      insert(key);
    }
  };
  onKeyDownRef.current = onKeyDown;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229) return;
      if (!mtextEditorClaimsKey(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onKeyDownRef.current(event);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const caretPoint = () => {
    if (!localLayout) return { x: 0, y: height * 0.8 };
    for (const run of localLayout.runs) {
      if (run.sourceStart < 0) continue;
      const end = run.sourceStart + run.text.length;
      if (caret < run.sourceStart || caret > end) continue;
      const offset = caret - run.sourceStart;
      const prefix = run.text.slice(0, offset);
      let advance = measure(prefix, run.span) + run.charGap * prefix.length;
      if (offset === run.text.length && run.width > advance) advance = run.width;
      return { x: run.x + advance, y: -run.y };
    }
    let cursor = 0;
    let y = 0;
    for (const paragraph of body.paragraphs) {
      const length = paragraph.spans.reduce((sum, span) => sum + span.text.length, 0);
      const lineHeight = Math.max(paragraph.spans[0]?.height ?? height, height * 0.2) * (paragraph.lineSpacing ?? 1);
      y += paragraph.spaceBefore ?? 0;
      if (caret <= cursor + length) {
        return { x: paragraph.indent ?? 0, y: y + lineHeight * 0.8 };
      }
      y += lineHeight + (paragraph.spaceAfter ?? 0);
      cursor += length + 1;
    }
    return { x: 0, y: (localLayout.height || height) * 0.8 };
  };

  const point = caretPoint();
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const origin = worldLayout
    ? worldToScreen(worldLayout.corners[0], camera, canvasWidth, canvasHeight)
    : { x: 0, y: 0 };
  const edge = worldLayout
    ? worldToScreen(worldLayout.corners[1], camera, canvasWidth, canvasHeight)
    : { x: origin.x + width * zoom, y: origin.y };
  const angle = Math.atan2(edge.y - origin.y, edge.x - origin.x);
  const loc = caretFromIndex(body, caret);
  const activeSpan = body.paragraphs[loc.paragraph]?.spans[loc.span];
  const activeParagraph = body.paragraphs[loc.paragraph];
  const fontFamily = pending.fontFamily || activeSpan?.fontFamily || 'Arial';
  const shownHeight = pending.height || activeSpan?.height || height;
  const boldOn = pending.bold ?? !!activeSpan?.bold;
  const italicOn = pending.italic ?? !!activeSpan?.italic;
  const face = {
    bold: boldOn,
    italic: italicOn,
    fontFamily,
  };
  const synthetic = (boldOn || italicOn) && !mtextFaceAvailable(face);

  return (
    <div className="mtext-layer" data-cad-text-editor="1">
      <div
        className="mtext-ribbon"
        data-cad-text-editor="1"
        role="toolbar"
        aria-label="Text editor"
        style={origin.y < 170 ? { top: 'auto', bottom: 8 } : undefined}
      >
        <div className="mtext-group">
          <span>Font</span>
          <select
            aria-label="Font family"
            value={fontFamily}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              applyRange({ fontFamily: event.target.value }, true);
              inputRef.current?.focus();
            }}
          >
            {MTEXT_FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <input
            aria-label="Text height"
            type="number"
            min={0.01}
            step={step}
            value={Number(shownHeight.toFixed(4))}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > 0) changeHeight(value);
            }}
          />
          <button type="button" title="Increase text height" onMouseDown={(event) => event.preventDefault()} onClick={() => changeHeight(shownHeight + step)}>
            A+
          </button>
          <button type="button" title="Decrease text height" onMouseDown={(event) => event.preventDefault()} onClick={() => changeHeight(shownHeight - step)}>
            A−
          </button>
          <input
            aria-label="Height increment"
            type="number"
            min={0.01}
            step={0.05}
            value={step}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > 0) setStep(value);
            }}
          />
          <button type="button" className={boldOn ? 'on' : ''} title={synthetic && boldOn ? 'Bold is synthesized for this font' : 'Bold'} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag('bold')}>
            B
          </button>
          <button type="button" className={italicOn ? 'on' : ''} title={synthetic && italicOn ? 'Italic is synthesized for this font' : 'Italic'} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag('italic')}>
            I
          </button>
          <button type="button" className={activeSpan?.underline ? 'on' : ''} title="Underline" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag('underline')}>
            U
          </button>
          <button type="button" className={activeSpan?.overline ? 'on' : ''} title="Overline" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag('overline')}>
            O
          </button>
          <button type="button" className={activeSpan?.strikethrough ? 'on' : ''} title="Strikethrough" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag('strikethrough')}>
            S
          </button>
          <input
            aria-label="Text color"
            type="color"
            value={activeSpan?.color || draft.color}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => applyRange({ color: event.target.value }, true)}
          />
          <input
            aria-label="Width factor"
            type="number"
            min={0.1}
            step={0.05}
            title="Width factor"
            value={Number((activeSpan?.widthFactor ?? 1).toFixed(3))}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > 0) applyRange({ widthFactor: value }, true);
            }}
          />
          <input
            aria-label="Character spacing"
            type="number"
            step={0.05}
            title="Character spacing"
            value={Number((activeSpan?.tracking ?? 0).toFixed(3))}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) applyRange({ tracking: value }, true);
            }}
          />
          <button type="button" title="Superscript" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRange({ baseline: 'super' }, false)}>
            x²
          </button>
          <button type="button" title="Subscript" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRange({ baseline: 'sub' }, false)}>
            x₂
          </button>
        </div>
        <div className="mtext-group">
          <span>Paragraph</span>
          {(['left', 'center', 'right', 'justify', 'distribute'] as const).map((align) => (
            <button
              key={align}
              type="button"
              className={activeParagraph?.align === align || (!activeParagraph?.align && align === 'left') ? 'on' : ''}
              title={align}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => alignParagraphs(align)}
            >
              {align === 'justify' ? 'Just' : align === 'distribute' ? 'Dist' : align[0]!.toUpperCase()}
            </button>
          ))}
          <select
            aria-label="Line spacing"
            value={String(activeParagraph?.lineSpacing ?? 1)}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => patchParagraphs({ lineSpacing: Number(event.target.value) })}
          >
            <option value="1">1.0</option>
            <option value="1.5">1.5</option>
            <option value="2">2.0</option>
          </select>
          <button type="button" title="Increase indent" onMouseDown={(event) => event.preventDefault()} onClick={() => patchParagraphs({ indent: (activeParagraph?.indent ?? 0) + height })}>
            Indent
          </button>
          <button
            type="button"
            title="Bullets"
            className={activeParagraph?.list === 'bullet' ? 'on' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => patchParagraphs({ list: activeParagraph?.list === 'bullet' ? 'none' : 'bullet' })}
          >
            •
          </button>
          <button
            type="button"
            title="Numbering"
            className={activeParagraph?.list === 'number' ? 'on' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => patchParagraphs({ list: activeParagraph?.list === 'number' ? 'none' : 'number' })}
          >
            1.
          </button>
          <button
            type="button"
            title="Tab stops"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => patchParagraphs({ tabs: [height * 2, height * 4, height * 6] })}
          >
            Tabs
          </button>
        </div>
        <div className="mtext-group">
          <span>Position</span>
          <div className="mtext-attachments" role="group" aria-label="Attachment point">
            {MTEXT_ATTACHMENTS.map((pointId) => (
              <button
                key={pointId}
                type="button"
                className={attachment === pointId ? 'on' : ''}
                title={ATTACHMENT_LABEL[pointId]}
                aria-label={ATTACHMENT_LABEL[pointId]}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setAttachment(pointId)}
              />
            ))}
          </div>
          <label>
            Rot
            <input
              aria-label="Rotation"
              type="number"
              value={Number(((rotation * 180) / Math.PI).toFixed(2))}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setRotation((Number(event.target.value) * Math.PI) / 180)}
            />
          </label>
          <label>
            Width
            <input
              aria-label="Boundary width"
              type="number"
              min={0.01}
              value={Number(width.toFixed(4))}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value > 0) setWidth(resizeMTextWidth({ ...geometry, height, width }, value).width ?? value);
              }}
            />
          </label>
          <button
            type="button"
            title="Fit text width. Changes the width factor. The boundary stays the same."
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const fitted = fitTextWidthFactor(
                { ...geometry, rotation, attachment, position: draft.position, width },
                measure,
              );
              if (fitted) commitBody(fitted, caret);
            }}
          >
            Fit
          </button>
        </div>
        <div className="mtext-group">
          <span>Edit</span>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={undo}>
            Undo
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={redo}>
            Redo
          </button>
          <select
            aria-label="Symbol"
            value=""
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.value) insert(event.target.value);
              event.target.value = '';
              inputRef.current?.focus();
            }}
          >
            <option value="">Symbol</option>
            {MTEXT_SYMBOLS.map((symbol) => (
              <option key={symbol.label} value={symbol.value}>
                {symbol.label}
              </option>
            ))}
          </select>
          <button type="button" className="primary" onMouseDown={(event) => event.preventDefault()} onClick={finish}>
            Finish
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      <div
        className="mtext-frame"
        style={{
          left: origin.x,
          top: origin.y,
          width: Math.max(width * zoom, 8),
          height: Math.max((localLayout?.height ?? height) * zoom, height * zoom),
          transform: `rotate(${angle}rad)`,
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          const local = localFromEvent(event);
          const index = indexAtLocal(
            { ...geometry, rotation, attachment, position: draft.position },
            local.x,
            local.y,
            measure,
          );
          dragRef.current = true;
          setAnchor(index);
          setCaret(index);
          event.currentTarget.setPointerCapture(event.pointerId);
          inputRef.current?.focus();
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const local = localFromEvent(event);
          setCaret(
            indexAtLocal(
              { ...geometry, rotation, attachment, position: draft.position },
              local.x,
              local.y,
              measure,
            ),
          );
        }}
        onPointerUp={() => {
          dragRef.current = false;
        }}
      >
        {localLayout?.runs.map((run, index) => {
          const start = run.sourceStart;
          const end = start + run.text.length;
          const overlap = start >= 0 && selectedStart < end && selectedEnd > start;
          const decorations = [
            run.span.underline ? 'underline' : '',
            run.span.overline ? 'overline' : '',
            run.span.strikethrough ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const px = (run.span.baseline === 'normal' ? run.span.height : run.span.height * 0.6) * zoom;
          const natural = measure(run.text, run.span) + run.charGap * Math.max(0, run.text.length - 1);
          const justified = run.charGap === 0 && run.width > natural + 1e-6;
          return (
            <span
              key={`${index}-${start}`}
              className={overlap ? 'mtext-run selected' : 'mtext-run'}
              style={{
                left: run.x * zoom,
                top: -run.y * zoom + (run.span.baseline === 'super' ? -px * 0.45 : run.span.baseline === 'sub' ? px * 0.2 : 0),
                font: mtextFontCss(run.span, px),
                color: run.span.color || draft.color,
                letterSpacing: `${(run.span.tracking + run.charGap) * zoom}px`,
                width: justified ? run.width * zoom : undefined,
                transform: `translateY(-80%) scaleX(${run.span.widthFactor})`,
                textDecoration: decorations || undefined,
              }}
            >
              {run.text}
            </span>
          );
        })}
        <div
          className="mtext-caret"
          style={{
            left: point.x * zoom,
            top: point.y * zoom,
            height: Math.max(14, shownHeight * zoom),
          }}
        />
        <input
          ref={inputRef}
          className="mtext-input"
          data-cad-text-editor="1"
          aria-label="Multiline text"
          autoFocus
          value=""
          onChange={() => undefined}
          onCompositionEnd={(event) => {
            if (event.data) insert(event.data);
            event.currentTarget.value = '';
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
