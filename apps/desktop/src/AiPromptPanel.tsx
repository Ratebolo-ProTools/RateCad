import { useEffect, useState } from 'react';
import type { CommandBus } from '@ratecad/commands';
import type { DrawingDocument, WorkspaceMode } from '@ratecad/core';
import {
  applyPreparedDraw,
  describeSelection,
  previewDrawPrompt,
  type PreparedPrompt,
} from '@ratecad/ai';

interface HistoryEntry {
  id: number;
  prompt: string;
  outcome: 'preview' | 'applied' | 'rejected';
  detail: string;
}

export interface AiPromptPanelProps {
  document: DrawingDocument;
  workspaceMode: WorkspaceMode;
  commandBus: CommandBus;
  sessionId: string | null;
  seed: string;
  seedNonce: number;
  open: boolean;
  onClose: () => void;
}

/**
 * Collapsible prompt panel. Generate Preview does not change the drawing.
 * Apply commits one BatchCommand through the session CommandBus.
 */
export function AiPromptPanel({
  document,
  workspaceMode,
  commandBus,
  sessionId,
  seed,
  seedNonce,
  open,
  onClose,
}: AiPromptPanelProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedPrompt | null>(null);
  const [preparedSessionId, setPreparedSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!seedNonce) return;
    setText(seed);
    setPrepared(null);
    setError(null);
    setNotice(null);
  }, [seed, seedNonce]);

  const unitsLabel = prepared
    ? prepared.unitsLabel
    : `${document.settings.units} display · ${document.settings.worldUnit ?? 'ft'} stored`;

  const pushHistory = (
    prompt: string,
    outcome: HistoryEntry['outcome'],
    detail: string,
  ) => {
    setHistory((prev) =>
      [{ id: Date.now(), prompt, outcome, detail }, ...prev].slice(0, 12),
    );
  };

  const generate = () => {
    const prompt = text.trim();
    setNotice(null);
    if (!prompt) {
      setPrepared(null);
      setError('Enter a drawing instruction before generating a preview.');
      return;
    }
    const result = previewDrawPrompt(prompt, {
      document: commandBus.getDocument(),
      workspaceMode,
    });
    if (!result.ok) {
      setPrepared(null);
      setError(result.error);
      pushHistory(prompt, 'rejected', result.error);
      return;
    }
    setError(null);
    setPrepared(result.prepared);
    setPreparedSessionId(sessionId);
    pushHistory(prompt, 'preview', result.prepared.summary);
  };

  const selection = describeSelection(document);

  const apply = () => {
    if (!prepared || !prepared.canApply) {
      setError('Generate a drawing preview before applying.');
      return;
    }
    if (preparedSessionId !== sessionId) {
      setPrepared(null);
      setError('The active drawing changed. Generate the preview again.');
      return;
    }
    const result = applyPreparedDraw(
      commandBus,
      prepared,
      workspaceMode,
    );
    if (!result.ok) {
      setError(result.error);
      pushHistory(prepared.prompt, 'rejected', result.error);
      return;
    }
    pushHistory(prepared.prompt, 'applied', prepared.summary);
    setPrepared(null);
    setError(null);
    setNotice('Applied. One Undo removes this drawing.');
  };

  const applyReady = prepared?.canApply === true;

  const cancel = () => {
    setText('');
    setPrepared(null);
    setError(null);
    setNotice(null);
  };

  return (
    <aside
      className="ai-panel"
      data-cad-text-editor="1"
      aria-label="AI Engineer"
      hidden={!open}
    >
      <div className="ai-panel-header">
        <h2 className="panel-title">AI Engineer</h2>
        <button
          type="button"
          className="ai-text-btn"
          onClick={onClose}
          aria-label="Collapse AI Engineer"
        >
          Collapse
        </button>
      </div>
      <p className="ai-lead">
        Preview a drawing, then apply it. A modification preview names the
        object and does not change the drawing.
      </p>
      <div className="ai-units" data-testid="ai-units">
        Units: {unitsLabel}
        {workspaceMode !== 'MODEL_SPACE' ? ' · switch to Model to apply' : ''}
      </div>
      <section className="ai-selection" data-testid="ai-selection">
        <h3 className="panel-title">Selected objects</h3>
        <p className="ai-selection-count" data-testid="ai-selection-count">
          {selection.count} selected
        </p>
        {selection.items.length ? (
          <ul>
            {selection.items.map((item) => (
              <li key={item.id} data-testid="ai-selection-item">
                <strong>{item.type}</strong>
                {' · '}
                {item.id}
                {' · '}
                {item.layerName}
                {' · '}
                {item.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-quiet">Select an object on the canvas to use it here.</p>
        )}
      </section>
      <label className="ai-label" htmlFor="ai-prompt-input">
        Prompt
      </label>
      <textarea
        id="ai-prompt-input"
        data-testid="ai-prompt-input"
        className="ai-prompt"
        rows={3}
        value={text}
        spellCheck={false}
        placeholder="Draw a 12 ft by 10 ft rectangle at 0,0"
        onChange={(event) => {
          setText(event.target.value);
          setNotice(null);
        }}
      />
      <div className="ai-actions">
        <button type="button" data-testid="ai-generate" onClick={generate}>
          Generate Preview
        </button>
        <button
          type="button"
          className="primary"
          data-testid="ai-apply"
          disabled={!applyReady}
          onClick={apply}
        >
          Apply Drawing
        </button>
        <button type="button" data-testid="ai-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <div className="ai-error" data-testid="ai-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="ai-notice">{notice}</div> : null}
      <section className="ai-summary" data-testid="ai-summary" aria-live="polite">
        <h3 className="panel-title">Proposed entities</h3>
        {prepared ? (
          <>
            <p>{prepared.summary}</p>
            <ul>
              {prepared.kind === 'draw'
                ? prepared.entities.map((entity) => (
                    <li key={`${entity.kind}-${entity.detail}`}>
                      <strong>{entity.kind}</strong>
                      {' · '}
                      {entity.layerName}
                      {' · '}
                      {entity.detail}
                    </li>
                  ))
                : prepared.entities.map((entity) => (
                    <li key={entity.id}>
                      <strong>{entity.type}</strong>
                      {' · '}
                      {entity.id}
                      {' · '}
                      {entity.layerName}
                      {' · '}
                      {entity.detail}
                    </li>
                  ))}
            </ul>
            {prepared.kind === 'modify' ? (
              <p className="ai-notice">{prepared.executionNote}</p>
            ) : null}
            {prepared.assumptions.length ? (
              <ul className="ai-assumptions">
                {prepared.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="ai-quiet">No placement was assumed.</p>
            )}
          </>
        ) : (
          <p className="ai-quiet">No preview yet.</p>
        )}
      </section>
      <section className="ai-history" data-testid="ai-history">
        <h3 className="panel-title">This session</h3>
        {history.length ? (
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="ai-history-item"
                  onClick={() => {
                    setText(entry.prompt);
                    setPrepared(null);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <span className={`ai-outcome ai-outcome-${entry.outcome}`}>
                    {entry.outcome}
                  </span>
                  {entry.prompt}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-quiet">Prompt history appears here.</p>
        )}
      </section>
    </aside>
  );
}
