import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
import type { UiV1, UiProvider, ExtensionHost } from '../../types';
import { CanvasView } from './components/CanvasView';
import { CanvasSidebar } from './components/CanvasSidebar';
import { initCanvas, useCanvasList, useCanvasListRaw } from './useCanvasStore';
import { DEFAULT_CANVAS_ID } from './constants';
import './styles.css';

// ─────────────────────────────────────────────────────────────────────
// The Canvas extension (shell-v2). ONE ui.extension.register that owns the
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

  // Default to the always-present default canvas once the list loads, so the
  // app opens onto a board rather than an empty pane.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId === null && loaded) setSelectedId(DEFAULT_CANVAS_ID);
  }, [selectedId, loaded]);

  // The sidebar still calls navigate('/canvas/<id>') — keep the component
  // verbatim and translate the route into app selection here.
  const select = useCallback((path: string) => {
    const id = path.startsWith('/canvas/') ? path.slice('/canvas/'.length) : path;
    if (id) setSelectedId(id);
  }, []);

  // If the open canvas is deleted from the list, fall back to the default board
  // instead of rendering a dead canvas.
  useEffect(() => {
    if (selectedId && loaded && !list.some((c) => c.id === selectedId)) setSelectedId(DEFAULT_CANVAS_ID);
  }, [selectedId, loaded, list]);

  // Refresh the canvas list on COMMIT (the user switched here), per the warm-keep
  // lifecycle — a canvas may have been created/deleted elsewhere while this app
  // was hidden. A peek is a glance and takes no such side effect.
  useEffect(() => host.lifecycle.onActivate(() => { void useCanvasListRaw().fetchList(); }), [host]);

  const sidebar = (
    <ExtensionSidebar
      header={<div className="canvas-sidebar-title">Canvases</div>}
      footer={
        <button
          className="btn-secondary btn-sm canvas-new-btn"
          onClick={() => { void showNewCanvasModal(ui, setSelectedId); }}
        >
          New Canvas
        </button>
      }
    >
      <CanvasSidebar navigate={(p) => select(p)} confirm={(o) => ui.modals.confirm(o)} />
    </ExtensionSidebar>
  );

  const main = selectedId ? (
    <CanvasView key={selectedId} canvasId={selectedId} />
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
  ui.extension.register({
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
