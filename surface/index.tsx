import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
// ActionButton + runActionInteractive come from the SUBPATH, not the kit barrel:
// the barrel re-exports heavy modules (Monaco/FileBrowser) esbuild can't
// tree-shake, which would bloat this lean extension by megabytes. The subpath
// pulls only the action machinery. runActionInteractive is the non-hook path the
// palette command uses to run an action; getSurfaceActionEnv resolves it in the
// realm.
import { ActionButton, runActionInteractive } from '@frontierengineer/ui/useAction';
import { getSurfaceActionEnv } from '@frontierengineer/ui/actionRegistry';
import type { SurfaceProvider, ExtensionHost } from '../../types';
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
// frontier.run_action, and the palette's "New Canvas" command is just the
// keybinding/face of it (group:'create' + actionId). The action lives in the
// daemon and hands the new canvas id to the render realm via prefs (pendingOpen)
// so the board opens — however it was created (in-app button, palette redirect,
// or agent).
// ─────────────────────────────────────────────────────────────────────

// The whole Canvas extension. Holds the selected canvas id; the sidebar
// selects, the main pane renders. `host` is the extension's ExtensionHost (its
// container, substrate, lifecycle, and the services carrying modals + prefs).
function CanvasApp({ host }: { host: ExtensionHost }) {
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

  // A create from OUTSIDE this render realm (the canvas.new command via the
  // palette redirect) can't call setSelectedId here, so canvas.create_canvas
  // leaves the new canvas id in prefs. Open exactly THAT canvas — refreshing this
  // realm's list first so the deletion-guard above doesn't immediately drop it —
  // then clear the signal. This is what makes "create a canvas" land you on the
  // board you just created, however it was created.
  useEffect(() => {
    const open = (id: unknown) => {
      if (typeof id !== 'string' || !id) return;
      host.services.prefs.delete('pendingOpen');
      void useCanvasListRaw().fetchList().then(() => setSelectedId(id));
    };
    open(host.services.prefs.get('pendingOpen'));
    const sub = host.services.prefs.watch('pendingOpen', open);
    return () => sub.unsubscribe();
  }, [host]);

  // Refresh the canvas list on COMMIT (the user switched here), per the warm-keep
  // lifecycle — a canvas may have been created/deleted elsewhere while this app
  // was hidden. A peek is a glance and takes no such side effect.
  useEffect(() => {
    const sub = host.lifecycle.onActivate(() => { void useCanvasListRaw().fetchList(); });
    return () => sub.unsubscribe();
  }, [host]);

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
      <CanvasSidebar navigate={(p) => select(p)} confirm={(o) => host.services.modals.confirm(o).then((r) => r === true)} />
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
  // background logic — it seeds the canvas store from its own services and
  // declares the create command + action, whose closures live here.
  surface.daemon.register({
    mount(ctx) {
      initCanvas(ctx.services.store);

      ctx.commands.register({
        id: 'canvas.new',
        label: 'New Canvas',
        category: 'Canvas',
        defaultKey: 'Alt+C',
        group: 'create',
        // The palette/keybinding FACE of canvas.create_canvas — the palette merges
        // them into one "New Canvas" row (carrying the action's description) and drops
        // the standalone action twin. The host redirects a group:'create' command to
        // this app (switchTo), and the action hands the new canvas id to the render
        // realm via prefs (pendingOpen) so the board opens. A command runs outside
        // React render, so resolve + run via the realm env, not the useAction hook.
        actionId: 'canvas.create_canvas',
        run: () => {
          const env = getSurfaceActionEnv();
          const action = env?.getAction('canvas.create_canvas');
          if (env && action) void runActionInteractive(env, action);
        },
      });

      // The create action (docs/core/extensions.md): the host generates its modal
      // from this schema AND an agent calls the SAME run() over MCP
      // (frontier.run_action "canvas.create_canvas"). Runs in this daemon (the
      // surface realm), never on the host.
      ctx.actions.register({
        id: 'canvas.create_canvas',
        title: 'New Canvas',
        description:
          'Create a new canvas — an infinite, zoomable whiteboard for sticky notes and ' +
          'colored areas — and open it. Give it a name. Returns the new canvas id. Same ' +
          'as the in-app "New Canvas" button.',
        input: {
          fields: [
            { key: 'name', type: 'string', label: 'Name', required: true, placeholder: 'My Canvas' },
          ],
        },
        async run(_ctx, input) {
          const args = (input ?? {}) as { name?: string };
          const name = String(args.name ?? '').trim();
          // Precondition → explicit failure outcome naming the field, so the host
          // modal points at the bad input and an agent gets a stable code.
          if (!name) return { ok: false, code: 'missing_name', field: 'name', error: 'A name is required to create a canvas.' };
          const info = await useCanvasListRaw().createCanvas(name);
          // Hand the new canvas id to the render realm so it opens THAT board (the
          // path the palette command relies on); the in-app button also focuses it
          // via onResult.
          ctx.services.prefs.set('pendingOpen', info.id);
          return { id: info.id, name: info.name };
        },
      });
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
    mount(host: ExtensionHost) {
      initCanvas(host.services.store);
      root = createRoot(host.container);
      root.render(<CanvasApp host={host} />);
      return () => { root?.unmount(); root = null; };
    },
  });
}
