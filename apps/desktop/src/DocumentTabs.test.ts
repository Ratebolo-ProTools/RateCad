import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DocumentTabs } from './DocumentTabs.js';
import {
  CLOSE_TAB_DISABLED_TOOLTIP,
  NEW_TAB_DISABLED_TOOLTIP,
  START_TAB_TOOLTIP,
  type DocumentTabItem,
} from './documentTabsModel.js';

function renderTabs(
  tabs: DocumentTabItem[],
  extras: Partial<Parameters<typeof DocumentTabs>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(DocumentTabs, {
      tabs,
      activeSessionId: tabs.find((t) => t.active)?.sessionId ?? null,
      multiDocumentActionsEnabled: false,
      ...extras,
    }),
  );
}

const sampleTabs: DocumentTabItem[] = [
  {
    sessionId: 'session-a',
    title: 'Untitled Drawing',
    displayName: 'Untitled Drawing',
    dirty: false,
    filePath: null,
    active: true,
  },
];

describe('P3-B2 DocumentTabs rendering', () => {
  it('renders Start tab, drawing tab, and add button', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain('data-testid="document-tabs"');
    expect(html).toContain('data-testid="doc-tab-start"');
    expect(html).toContain('>Start<');
    expect(html).toContain('data-testid="doc-tab-session-a"');
    expect(html).toContain('Untitled Drawing');
    expect(html).toContain('data-testid="doc-tab-add"');
  });

  it('highlights the active tab', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain('doc-tab active');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-selected="true"');
  });

  it('associates session id on drawing tabs', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain('data-session-id="session-a"');
    expect(html).toContain('aria-controls="drawing-session-session-a"');
  });

  it('renders untitled drawing title', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain('Untitled Drawing');
  });

  it('renders saved filename title', () => {
    const html = renderTabs([
      {
        sessionId: 'session-b',
        title: 'Warehouse',
        displayName: 'Warehouse',
        dirty: false,
        filePath: '/docs/Warehouse.ratecad',
        active: true,
      },
    ]);
    expect(html).toContain('Warehouse');
    expect(html).toContain('/docs/Warehouse.ratecad');
  });

  it('renders unsaved indicator in label and accessibility text', () => {
    const html = renderTabs([
      {
        sessionId: 'session-c',
        title: 'Draft',
        displayName: 'Draft *',
        dirty: true,
        filePath: null,
        active: true,
      },
    ]);
    expect(html).toContain('Draft *');
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('unsaved changes');
  });

  it('keeps Start tab visible as a disabled placeholder', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain(START_TAB_TOOLTIP);
    expect(html).toMatch(/doc-tab-start[^>]*disabled/);
  });

  it('disables multi-document new and close actions', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain(NEW_TAB_DISABLED_TOOLTIP);
    expect(html).toContain(CLOSE_TAB_DISABLED_TOOLTIP);
    expect(html).toContain('doc-tab-add is-disabled');
    expect(html).toContain('doc-tab-close is-disabled');
    expect(html).toMatch(/doc-tab-add[^>]*disabled/);
  });

  it('exposes keyboard focus affordances on tabs', () => {
    const html = renderTabs(sampleTabs);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-label="Drawings"');
  });

  it('supports overflow-ready scroll container markup', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      sessionId: `session-${i}`,
      title: `Drawing ${i}`,
      displayName: `Drawing ${i}${i === 3 ? ' *' : ''}`,
      dirty: i === 3,
      filePath: null,
      active: i === 3,
    }));
    const html = renderTabs(many, { activeSessionId: 'session-3' });
    expect(html).toContain('document-tabs-scroll');
    expect(html).toContain('doc-tab-add');
    expect(html).toContain('doc-tab-start');
    expect(html.match(/data-session-id=/g)?.length).toBe(8);
  });

  it('can enable multi-document actions when explicitly allowed (future)', () => {
    const html = renderTabs(sampleTabs, {
      multiDocumentActionsEnabled: true,
    });
    expect(html).not.toContain('doc-tab-add is-disabled');
    expect(html).toContain('aria-label="New drawing"');
  });
});
