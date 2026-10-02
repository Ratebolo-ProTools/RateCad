import {
  ApplyTitleBlockCommand,
  SetViewportLabelCommand,
  UpdateLayoutPageSettingsCommand,
  UpdateSheetInfoCommand,
  type CommandBus,
} from '@ratecad/commands';
import {
  PAPER_SIZE_MM,
  createA3LandscapeTemplate,
  defaultSheetInfo,
  defaultTitleBlock,
  formatViewportScale,
  type DrawingDocument,
  type LayoutId,
  type PageOrientation,
  type PaperSizeId,
  type SheetInfo,
  type ViewportId,
} from '@ratecad/core';

type Props = {
  doc: DrawingDocument;
  bus: CommandBus;
  layoutId: LayoutId;
  selectedViewportId?: ViewportId | null;
};

const PAPER_SIZES: PaperSizeId[] = ['A4', 'A3', 'A2', 'A1', 'A0'];

export function LayoutPropertiesPanel({
  doc,
  bus,
  layoutId,
  selectedViewportId,
}: Props) {
  const layout = doc.layouts.find((l) => l.id === layoutId);
  if (!layout) return null;
  const page = layout.pageSettings;
  const info = layout.sheetInfo ?? defaultSheetInfo();
  const vp = selectedViewportId
    ? layout.viewports.find((v) => v.id === selectedViewportId)
    : null;
  const vpIndex = vp
    ? layout.viewports.findIndex((v) => v.id === vp.id)
    : -1;

  const setPage = (patch: Partial<typeof page>) => {
    bus.execute(
      new UpdateLayoutPageSettingsCommand(layoutId, { ...page, ...patch }),
    );
  };

  const setInfoField = (key: keyof SheetInfo, value: string) => {
    bus.execute(
      new UpdateSheetInfoCommand(layoutId, { ...info, [key]: value }),
    );
  };

  const sizeMm = PAPER_SIZE_MM[page.paperSize];
  const sheetW =
    page.orientation === 'landscape' ? sizeMm.height : sizeMm.width;
  const sheetH =
    page.orientation === 'landscape' ? sizeMm.width : sizeMm.height;

  return (
    <section className="panel-section properties-engine">
      <h2 className="panel-title">Sheet / Layout</h2>
      <div className="prop-row">
        <label>Layout</label>
        <span className="value">{layout.name}</span>
      </div>
      <div className="prop-row">
        <label>Paper</label>
        <select
          className="prop-select"
          value={page.paperSize}
          onChange={(e) => setPage({ paperSize: e.target.value as PaperSizeId })}
        >
          {PAPER_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <label>Orient</label>
        <select
          className="prop-select"
          value={page.orientation}
          onChange={(e) =>
            setPage({ orientation: e.target.value as PageOrientation })
          }
        >
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Units</label>
        <select
          className="prop-select"
          value={page.units}
          onChange={(e) =>
            setPage({ units: e.target.value === 'inch' ? 'inch' : 'mm' })
          }
        >
          <option value="mm">mm</option>
          <option value="inch">inch</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Margin</label>
        <input
          className="prop-select"
          type="number"
          min={0}
          step={1}
          value={page.margin}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) setPage({ margin: n });
          }}
        />
      </div>
      <div className="prop-row">
        <label>Sheet</label>
        <span className="value">
          {sheetW}×{sheetH} mm
        </span>
      </div>

      <h2 className="panel-title" style={{ marginTop: 14 }}>
        Sheet information
      </h2>
      {(
        [
          ['project', 'Project'],
          ['drawingTitle', 'Drawing'],
          ['drawingNo', 'Drawing No'],
          ['scale', 'Scale'],
          ['revision', 'Revision'],
          ['date', 'Date'],
          ['drawnBy', 'Drawn by'],
          ['checkedBy', 'Checked by'],
        ] as Array<[keyof SheetInfo, string]>
      ).map(([key, label]) => (
        <div className="prop-row" key={key}>
          <label>{label}</label>
          <input
            className="prop-select"
            value={info[key]}
            onChange={(e) => setInfoField(key, e.target.value)}
          />
        </div>
      ))}

      <h2 className="panel-title" style={{ marginTop: 14 }}>
        Title block
      </h2>
      <button
        type="button"
        className="mini-btn block"
        onClick={() => {
          const tpl = createA3LandscapeTemplate();
          bus.execute(
            new UpdateLayoutPageSettingsCommand(layoutId, tpl.pageSettings),
          );
          bus.execute(
            new ApplyTitleBlockCommand(layoutId, {
              ...tpl.sheetInfo,
              ...(layout.sheetInfo ?? {}),
            }, tpl.titleBlock.templateId),
          );
        }}
      >
        Apply A3 Landscape template
      </button>
      <button
        type="button"
        className="mini-btn block"
        onClick={() => {
          const block = layout.titleBlock ?? defaultTitleBlock(page);
          bus.execute(
            new ApplyTitleBlockCommand(layoutId, info, block.templateId),
          );
        }}
      >
        Apply / refresh title block
      </button>
      <p className="empty-props">
        Title block is Paper Space geometry. Changing paper size does not
        modify Model Space.
      </p>

      {vp ? (
        <>
          <h2 className="panel-title" style={{ marginTop: 14 }}>
            Viewport label
          </h2>
          <div className="prop-row">
            <label>Title</label>
            <input
              className="prop-select"
              defaultValue={vp.label ?? `Viewport ${vpIndex + 1}`}
              onBlur={(e) => {
                bus.execute(
                  new SetViewportLabelCommand(
                    layoutId,
                    vp.id,
                    e.target.value,
                    vp.scaleLabel ?? `Scale ${formatViewportScale(vp.scale)}`,
                    true,
                  ),
                );
              }}
            />
          </div>
          <div className="prop-row">
            <label>Scale txt</label>
            <input
              className="prop-select"
              defaultValue={
                vp.scaleLabel ?? `Scale ${formatViewportScale(vp.scale)}`
              }
              onBlur={(e) => {
                bus.execute(
                  new SetViewportLabelCommand(
                    layoutId,
                    vp.id,
                    vp.label ?? `Viewport ${vpIndex + 1}`,
                    e.target.value,
                    true,
                  ),
                );
              }}
            />
          </div>
          <button
            type="button"
            className="mini-btn block"
            onClick={() => {
              bus.execute(
                new SetViewportLabelCommand(
                  layoutId,
                  vp.id,
                  vp.label ?? `Viewport ${vpIndex + 1}`,
                  vp.scaleLabel ?? `Scale ${formatViewportScale(vp.scale)}`,
                  !vp.showLabel,
                ),
              );
            }}
          >
            {vp.showLabel ? 'Hide viewport label' : 'Show viewport label'}
          </button>
        </>
      ) : null}
    </section>
  );
}
