import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
// ActionButton comes from the SUBPATH, not the kit barrel: the barrel re-exports
// heavy modules (Monaco/FileBrowser) esbuild can't tree-shake, which would bloat
// this lean extension by megabytes. The subpath pulls only the action machinery.
import { ActionButton } from '@frontierengineer/ui/useAction';
import type { SurfaceProvider, SurfaceApplicationContext } from '../../types';
import { CanvasView } from './components/CanvasView';
import { CanvasSidebar } from './components/CanvasSidebar';
import { initCanvas, useCanvasList, useCanvasListRaw } from './useCanvasStore';
import './styles.css';

// ─────────────────────────────────────────────────────────────────────
// The Canvas extension (shell-v2). ONE ui.application.register that owns the
// whole content rect: a left rail listing the canvases (with a New Canvas action)
// and a main pane holding one infinite whiteboard. There is no host tab bar — the
// extension holds the selected canvas in its own state and swaps the board in
// the main pane.
//
// Creating a canvas is an ACTION (canvas.create_canvas), not a bespoke modal: the
// host renders its modal from the input schema, an agent calls the SAME run() via
// frontier.run_action, and — since every action appears in the command palette —
// the palette lists "New Canvas" directly (it carries the palette fields
// category/defaultKey/group:'create'). The action lives in the daemon and hands
// the new canvas id to the render realm via localSettings + a bus.extension event
// (pendingOpen) so the board opens — however it was created (in-app button,
// palette invocation, or agent).
// ─────────────────────────────────────────────────────────────────────

// The whole Canvas extension. Holds the selected canvas id; the sidebar
// selects, the main pane renders. `context` is the extension's SurfaceApplicationContext (its
// container, substrate, lifecycle, and the services carrying modals +
// localSettings).
function CanvasApp({ context }: { context: SurfaceApplicationContext }) {
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

  // A create from OUTSIDE this render realm (canvas.create_canvas invoked from
  // the palette or by an agent) can't call setSelectedId here, so the action
  // signals the new canvas id on two channels. Open exactly THAT canvas —
  // refreshing this realm's list first so the deletion-guard above doesn't
  // immediately drop it — then clear the signal. This is what makes "create a
  // canvas" land you on the board you just created, however it was created.
  //
  // Two channels, because local settings are storage, not a signaling channel
  // (it cannot be watched): read the value left in localSettings at mount (a
  // create that happened before this app warmed), and subscribe to the live
  // bus.extension event (a create while this app is already open).
  useEffect(() => {
    const open = (id: unknown) => {
      if (typeof id !== 'string' || !id) return;
      context.localSettings.delete('pendingOpen');
      void useCanvasListRaw().fetchList().then(() => setSelectedId(id));
    };
    open(context.localSettings.get('pendingOpen'));
    const sub = context.bus.extension.subscribe('pendingOpen', open);
    return () => sub.unsubscribe();
  }, [context]);

  // Refresh the canvas list on activation (the user switched here), per the
  // warm-keep lifecycle — a canvas may have been created/deleted elsewhere while
  // this app was hidden.
  useEffect(() => {
    const sub = context.lifecycle.onFocus(() => { void useCanvasListRaw().fetchList(); });
    return () => sub.unsubscribe();
  }, [context]);

  const sidebar = (
    <ExtensionSidebar
      footer={
        // New Canvas IS the action's UI — clicking opens the host-rendered modal,
        // runs canvas.create_canvas, and onResult focuses the new board here.
        <ActionButton
          actionId="canvas.create_canvas"
          className="btn-secondary btn-sm canvas-new-btn"
          onResult={(v) => { const id = (v as { id?: string } | undefined)?.id; if (id) setSelectedId(id); }}
        >
          New Canvas
        </ActionButton>
      }
    >
      <CanvasSidebar navigate={(p) => select(p)} confirm={(o) => context.modals.confirm(o).then((r) => r === true)} />
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
        <ActionButton
          actionId="canvas.create_canvas"
          className="btn-primary canvas-empty-create"
          onResult={(v) => { const id = (v as { id?: string } | undefined)?.id; if (id) setSelectedId(id); }}
        >
          Create your first canvas
        </ActionButton>
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

export function register(surfaceProvider: SurfaceProvider): void {
  const surface = surfaceProvider.version(1);

  // The DAEMON: the always-on headless component that hosts the extension's
  // background logic — it seeds the canvas store from its own context and
  // declares the create action, whose closure lives here.
  surface.daemon.register({
    mount(ctx) {
      initCanvas(ctx.store);

      // The create action (docs/core/extensions.md): the host generates its modal
      // from this schema AND an agent calls the SAME run() over MCP
      // (frontier.run_action "canvas.create_canvas"). Runs in this daemon (the
      // surface realm), never on the host. Because every action is palette-
      // invocable, this one carries the palette fields the old "New Canvas"
      // command used to hold (category/defaultKey/group:'create'); the group
      // 'create' marks it as the extension's primary New action for the Home CTAs.
      ctx.actions.register({
        id: 'canvas.create_canvas',
        title: 'New Canvas',
        description:
          'Create a new canvas — an infinite, zoomable whiteboard for sticky notes and ' +
          'colored areas — and open it. Give it a name. Returns the new canvas id. Same ' +
          'as the in-app "New Canvas" button.',
        category: 'Canvas',
        defaultKey: 'Alt+C',
        group: 'create',
        input: {
          fields: [
            { key: 'name', type: 'string', label: 'Name', description: null, required: true, default: null, placeholder: 'My Canvas' },
          ],
        },
        // Returns a plain { id, name }, not a declared output schema. The action's
        // realm is simply the bundle that holds its closure — this surface daemon —
        // not a field it declares.
        output: null,
        async run(_ctx, input) {
          const args = (input ?? {}) as { name?: string };
          const name = String(args.name ?? '').trim();
          // Precondition → explicit failure outcome naming the field, so the host
          // modal points at the bad input and an agent gets a stable code.
          if (!name) return { ok: false, code: 'missing_name', field: 'name', error: 'A name is required to create a canvas.' };
          const info = await useCanvasListRaw().createCanvas(name);
          // Hand the new canvas id to the render realm so it opens THAT board (the
          // path the palette command relies on); the in-app button also focuses it
          // via onResult. Two channels: leave it in localSettings for an app that
          // has not warmed yet to read at mount, and publish a bus.extension event
          // so an already-open app reacts live.
          ctx.localSettings.set('pendingOpen', info.id);
          ctx.bus.extension.publish('pendingOpen', info.id);
          return { id: info.id, name: info.name };
        },
      });
      // Nothing to tear down: the action deregisters with the daemon.
      return {};
    },
  });

  // ONE extension content surface — the whole canvas experience lives inside
  // this mount.
  let root: ReturnType<typeof createRoot> | null = null;
  surface.application.register({
    id: 'canvas',
    title: 'Canvas',
    // An infinite-canvas glyph: a framed board with a couple of nodes.
    icon: 'M2 3.5h12v9H2zM5 6.5h3v2H5zM9.5 8.5h2.5v2H9.5z',
    color: '#6366f1',
    // Runs on any surface; no capability floor.
    requires: null,
    mount(context: SurfaceApplicationContext) {
      initCanvas(context.store);
      root = createRoot(context.container);
      root.render(<CanvasApp context={context} />);
      return { dispose: () => { root?.unmount(); root = null; } };
    },
  });
}
