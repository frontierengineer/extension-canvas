import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
import type { UiV1, UiProvider, ExtensionHost } from '../../types';
import { CanvasView } from './components/CanvasView';
import { CanvasSidebar } from './components/CanvasSidebar';
import { initCanvas, useCanvasList, useCanvasListRaw } from './useCanvasStore';
import './styles.css';

// ─────────────────────────────────────────────────────────────────────
// The Canvas extension (shell-v2). ONE ui.application.register that owns the
// whole content rect: a left rail listing the canvases (with a New Canvas action)
// and a main pane holding one infinite whiteboard. There is no host tab bar — the
// extension holds the selected canvas in its own state and swaps the board in
// the main pane. The sidebar + canvas components are re-housed verbatim; only
// their wiring (route navigation → extension selection) changed.
// ─────────────────────────────────────────────────────────────────────

// The whole Canvas extension. Holds the selected canvas id; the sidebar
// selects, the main pane renders. `ui` is the controller realm's UiV1 (for
// host-rendered modals); `host` is the extension's ExtensionHost (its
// container, substrate, lifecycle).
function CanvasApp({ ui, host }: { ui: UiV1; host: ExtensionHost }) {
  const list = useCanvasList((a) => a.list);
  const loaded = useCanvasList((a) => a.loaded);

  // Open onto the first canvas once the list loads, so the app lands on a board
  // rather than an empty pane. With no canvases yet, stay unselected and let the
  // main pane render the empty-state prompt.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId === null && loaded && list.length > 0) setSelectedId(list[0].id);
  }, [selectedId, loaded, list]);

  // The sidebar still calls navigate('/canvas/<id>') — keep the component
  // verbatim and translate the route into app selection here.
  const select = useCallback((path: string) => {
    const id = path.startsWith('/canvas/') ? path.slice('/canvas/'.length) : path;
    if (id) setSelectedId(id);
  }, []);

  // If the open canvas is deleted, fall back to the first remaining board — or to
  // no selection (the empty state) when it was the last one.
  useEffect(() => {
    if (selectedId && loaded && !list.some((c) => c.id === selectedId)) setSelectedId(list[0]?.id ?? null);
  }, [selectedId, loaded, list]);

  // Refresh the canvas list on COMMIT (the user switched here), per the warm-keep
  // lifecycle — a canvas may have been created/deleted elsewhere while this app
  // was hidden. A peek is a glance and takes no such side effect.
  useEffect(() => host.lifecycle.onActivate(() => { void useCanvasListRaw().fetchList(); }), [host]);

  const sidebar = (
    <ExtensionSidebar
      footer={
        <button
          className="btn-secondary btn-sm canvas-new-btn"
          onClick={() => { void showNewCanvasModal(ui, setSelectedId); }}
        >
          New Canvas
        </button>
      }
    >
      <CanvasSidebar navigate={(p) => select(p)} confirm={(o) => ui.modals.confirm(o).then((r) => r === true)} />
    </ExtensionSidebar>
  );

  // Three states: an open board, the first-run empty prompt (list loaded but
  // empty — e.g. the user deleted their last canvas), or the brief load.
  const main = selectedId ? (
    <CanvasView key={selectedId} canvasId={selectedId} />
  ) : loaded && list.length === 0 ? (
    <div className="canvas-empty-pane">
      <div className="canvas-empty-prompt">
        <div className="canvas-empty-title">No canvases yet</div>
        <div className="canvas-empty-body">
          Create your first canvas to start dropping sticky notes and sketching out
          areas on an infinite board.
        </div>
        <button
          className="btn-primary canvas-empty-create"
          onClick={() => { void showNewCanvasModal(ui, setSelectedId); }}
        >
          Create your first canvas
        </button>
      </div>
    </div>
  ) : (
    <div className="canvas-empty-pane">Loading…</div>
  );

  return (
    <div className="canvas-app">
      <Split
        first={sidebar}
        second={main}
        initialFirstSize={240}
        minFirstSize={170}
        minSecondSize={360}
        storageKey="canvas.split"
      />
    </div>
  );
}

export function register(uiProvider: UiProvider): void {
  const ui = uiProvider.version(1);
  initCanvas(ui.services.store);

  ui.commands.register({
    id: 'canvas.new',
    label: 'New Canvas',
    category: 'Canvas',
    defaultKey: 'Alt+C',
    group: 'create',
    // The create command runs in the controller realm, which has no
    // openExtension — a palette/Home invocation can't itself switch the shell
    // to the Canvas extension. It opens the host-rendered modal and creates the
    // canvas; the new canvas appears in the rail once the Canvas extension is
    // shown. The in-extension New Canvas button takes the richer path (a select
    // callback) so the fresh canvas opens in the main pane immediately.
    run: () => { void showNewCanvasModal(ui); },
  });

  // ONE extension content surface — the whole canvas experience lives inside
  // this mount.
  let root: ReturnType<typeof createRoot> | null = null;
  ui.application.register({
    id: 'canvas',
    title: 'Canvas',
    // An infinite-canvas glyph: a framed board with a couple of nodes.
    icon: 'M2 3.5h12v9H2zM5 6.5h3v2H5zM9.5 8.5h2.5v2H9.5z',
    color: '#6366f1',
    mount(host: ExtensionHost) {
      root = createRoot(host.container);
      root.render(<CanvasApp ui={ui} host={host} />);
      return () => { root?.unmount(); root = null; };
    },
  });
}

async function showNewCanvasModal(ui: UiV1, onCreated?: (canvasId: string) => void): Promise<void> {
  const result = await ui.modals.prompt({
    title: 'New Canvas',
    fields: [{ key: 'name', label: 'Name', type: 'string', placeholder: 'My Canvas', required: true }],
    submitLabel: 'Create',
  });
  if (!result) return;
  try {
    const info = await useCanvasListRaw().createCanvas(result.name);
    onCreated?.(info.id);
  } catch (err) {
    console.error('[canvas] create failed:', err);
  }
}
