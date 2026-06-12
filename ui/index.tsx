import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UiV1, UiProvider, ViewContext } from '../../types';
import { CanvasView } from './components/CanvasView';
import { CanvasSidebar } from './components/CanvasSidebar';
import { initCanvas, useCanvasList, useCanvasListRaw } from './useCanvasStore';
import { DEFAULT_CANVAS_ID } from './constants';
import './styles.css';

// Pushes this canvas tab's label to the host via ctx.setLabel — on mount and
// whenever the canvas's name changes (a rename). Replaces the old pull-based
// tabLabel(); renders nothing.
function CanvasTabLabel({ canvasId, ctx }: { canvasId: string; ctx: ViewContext }) {
  const name = useCanvasList((api) => api.list.find((c) => c.id === canvasId)?.name);
  useEffect(() => {
    ctx.setLabel({ primary: 'Canvas', secondary: name || (canvasId === DEFAULT_CANVAS_ID ? 'Canvas' : canvasId) });
  }, [name, canvasId, ctx]);
  return null;
}

export function register(uiProvider: UiProvider): void {
  const ui = uiProvider.version(1);
  initCanvas(ui.services.store);

  const viewRoots = new Map<HTMLElement, Root>();
  let sidebarRoot: Root | null = null;

  ui.commands.register({
    id: 'canvas.new',
    label: 'New Canvas',
    category: 'Canvas',
    defaultKey: 'Alt+C',
    run: () => { void showNewCanvasModal(ui); },
  });

  ui.sidebar.register({
    id: 'canvas-list',
    title: 'Canvases',
    actions: [{ commandId: 'canvas.new', icon: '+', tooltip: 'New Canvas' }],
    mount(container) {
      sidebarRoot = createRoot(container);
      sidebarRoot.render(<CanvasSidebar navigate={(p, o) => ui.navigate(p, o)} confirm={(o) => ui.modals.confirm(o)} />);
    },
    unmount() {
      sidebarRoot?.unmount();
      sidebarRoot = null;
    },
  });

  ui.views.register({
    id: 'canvas',
    tabType: 'canvas',
    // `/canvas/<id>` → canvas:<id>. Every entry point navigates with a concrete
    // id (the welcome tile + sidebar use DEFAULT_CANVAS_ID), so one prefix route
    // covers it — no bare `/canvas` form to special-case.
    routes: [{ prefix: '/canvas/' }],
    mount(tabId, container, ctx) {
      const root = createRoot(container);
      const canvasId = tabId.slice('canvas:'.length);
      root.render(
        <>
          <CanvasTabLabel canvasId={canvasId} ctx={ctx} />
          <CanvasView canvasId={canvasId} />
        </>,
      );
      viewRoots.set(container, root);
    },
    unmount(container) {
      viewRoots.get(container)?.unmount();
      viewRoots.delete(container);
    },
  });

  ui.welcome.contribute({
    id: 'canvas-open',
    title: 'Open Canvas',
    description: 'Open the visual whiteboard canvas for spatial planning.',
    action: { label: 'Open Canvas', run: () => ui.navigate(`/canvas/${DEFAULT_CANVAS_ID}`) },
  });
}

async function showNewCanvasModal(ui: UiV1): Promise<void> {
  const result = await ui.modals.prompt({
    title: 'New Canvas',
    fields: [{ key: 'name', label: 'Name', type: 'string', placeholder: 'My Canvas', required: true }],
    submitLabel: 'Create',
  });
  if (!result) return;
  try {
    const info = await useCanvasListRaw().createCanvas(result.name);
    ui.navigate(`/canvas/${info.id}`);
  } catch (err) {
    console.error('[canvas] create failed:', err);
  }
}
