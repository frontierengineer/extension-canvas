import type { Store } from '../../types';
import type { CanvasLayout, CanvasLayoutPatch, CanvasInfo, CanvasEntityValue, CanvasMeta } from './types';
import { DEFAULT_CANVAS_LAYOUT } from './constants';

const layoutKey = (id: string) => `canvases/${id}/layout.json`;
const metaKey = (id: string) => `canvases/${id}/meta.json`;

async function readMeta(store: Store, id: string): Promise<CanvasMeta | null> {
  const r = await store.getJson<Partial<CanvasMeta>>(metaKey(id));
  if (!r.ok) throw new Error(r.error.message);
  if (r.value === null) return null;
  return { name: r.value.name || id };
}

async function writeMeta(store: Store, id: string, meta: CanvasMeta): Promise<void> {
  await store.putJson({ key: metaKey(id), value: meta });
}

async function readLayout(store: Store, id: string): Promise<CanvasLayout> {
  const r = await store.getJson<Partial<CanvasLayout>>(layoutKey(id));
  if (!r.ok) throw new Error(r.error.message);
  if (r.value === null) return { ...DEFAULT_CANVAS_LAYOUT };
  const parsed = r.value;
  return {
    version: parsed.version || 1,
    viewport: { ...DEFAULT_CANVAS_LAYOUT.viewport, ...(parsed.viewport || {}) },
    spaces: parsed.spaces || {},
    areas: parsed.areas || [],
  };
}

async function writeLayout(store: Store, id: string, layout: CanvasLayout): Promise<void> {
  await store.putJson({ key: layoutKey(id), value: layout });
}

export async function listCanvases(store: Store): Promise<CanvasInfo[]> {
  const ids = new Set<string>();
  for (const key of (await store.list('canvases')).keys) {
    const parts = key.split('/');
    if (parts.length >= 2) ids.add(parts[1]);
  }
  const out: CanvasInfo[] = [];
  for (const id of ids) {
    const meta = await readMeta(store, id);
    out.push({ id, name: meta?.name || id });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getCanvas(store: Store, id: string): Promise<CanvasEntityValue> {
  const layout = await readLayout(store, id);
  const meta = await readMeta(store, id);
  return { name: meta?.name || id, layout };
}

export async function patchCanvas(
  store: Store,
  id: string,
  patch: { name?: string; layout?: CanvasLayoutPatch },
): Promise<CanvasEntityValue> {
  let layout: CanvasLayout;
  if (patch.layout) {
    const current = await readLayout(store, id);
    layout = {
      version: current.version,
      viewport: patch.layout.viewport ? { ...patch.layout.viewport } : current.viewport,
      spaces: { ...current.spaces },
      areas: patch.layout.areas ? [...patch.layout.areas] : current.areas,
    };
    if (patch.layout.spaces) {
      for (const [uid, entry] of Object.entries(patch.layout.spaces)) {
        if (entry === null) delete layout.spaces[uid];
        else layout.spaces[uid] = entry;
      }
    }
    await writeLayout(store, id, layout);
  } else {
    layout = await readLayout(store, id);
  }
  let name: string;
  if (typeof patch.name === 'string') {
    await writeMeta(store, id, { name: patch.name });
    name = patch.name;
  } else {
    name = (await readMeta(store, id))?.name || id;
  }
  return { name, layout };
}

export async function createCanvas(store: Store, name: string): Promise<CanvasInfo> {
  const trimmed = (name || '').trim() || 'New canvas';
  const slugBase = trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'canvas';
  let slug = slugBase;
  let n = 2;
  while ((await store.getString(metaKey(slug))).value) slug = `${slugBase}_${n++}`;
  await writeMeta(store, slug, { name: trimmed });
  await writeLayout(store, slug, { ...DEFAULT_CANVAS_LAYOUT });
  return { id: slug, name: trimmed };
}

export async function deleteCanvas(store: Store, id: string): Promise<void> {
  await store.delete(metaKey(id));
  await store.delete(layoutKey(id));
}

export async function renameCanvas(store: Store, id: string, name: string): Promise<CanvasInfo> {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  await writeMeta(store, id, { name: trimmed });
  return { id, name: trimmed };
}
