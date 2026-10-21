import { create } from 'zustand';
import type {
  CanvasLayout,
  CanvasSpaceLayout,
  CanvasArea,
  CanvasViewport,
  CanvasLayoutPatch,
  CanvasInfo,
} from './types';
import { DEFAULT_CANVAS_LAYOUT } from './constants';
import type { Store } from '../../types';
import { listCanvases, getCanvas, patchCanvas, createCanvas, deleteCanvas, renameCanvas } from './data';

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: number | null = null;
  return ((...args: any[]) => {
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  }) as T;
}

interface CanvasInstance {
  layout: CanvasLayout;
  loaded: boolean;
  draggingActive: boolean;
  draggingUid: string | null;
  draggingAreaId: string | null;
  carriedUids: Set<string>;
  carriedAreaIds: Set<string>;
  selectedUids: Set<string>;
  selectedAreaIds: Set<string>;
}

function makeInstance(): CanvasInstance {
  return {
    layout: { ...DEFAULT_CANVAS_LAYOUT },
    loaded: false,
    draggingActive: false,
    draggingUid: null,
    draggingAreaId: null,
    carriedUids: new Set(),
    carriedAreaIds: new Set(),
    selectedUids: new Set(),
    selectedAreaIds: new Set(),
  };
}

interface RootState {
  instances: Record<string, CanvasInstance>;
  list: CanvasInfo[];
  listLoaded: boolean;
}

const useRoot = create<RootState>(() => ({
  instances: {},
  list: [],
  listLoaded: false,
}));

const EMPTY_INSTANCE: CanvasInstance = makeInstance();

function readInstance(id: string): CanvasInstance {
  return useRoot.getState().instances[id] || EMPTY_INSTANCE;
}

function patchInstance(id: string, patch: Partial<CanvasInstance>) {
  const cur = useRoot.getState().instances[id] || makeInstance();
  useRoot.setState({ instances: { ...useRoot.getState().instances, [id]: { ...cur, ...patch } } });
}

let store: Store | null = null;

export function initCanvas(s: Store): void {
  if (store) return;
  store = s;

  const refreshLoaded = () => {
    if (!store) return;
    const instances = useRoot.getState().instances;
    for (const id of Object.keys(instances)) {
      if (!instances[id]?.loaded) continue;
      getCanvas(store, id).then((data) => {
        if (!data?.layout) return;
        if (readInstance(id).draggingActive) return;
        patchInstance(id, { layout: data.layout });
      });
    }
  };

  s.watch('canvases', () => {
    listApi.fetchList();
    refreshLoaded();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshLoaded();
    });
  }
}

const flushState: Record<string, {
  flushViewport: (v: CanvasViewport) => void;
  pendingSpaces: Record<string, CanvasSpaceLayout | null>;
  flushSpaces: () => void;
  pendingAreas: CanvasArea[] | null;
  flushAreas: () => void;
}> = {};

function getFlushState(id: string) {
  const existing = flushState[id];
  if (existing) return existing;
  const state = {
    pendingSpaces: {} as Record<string, CanvasSpaceLayout | null>,
    pendingAreas: null as CanvasArea[] | null,
    flushViewport: debounce((viewport: CanvasViewport) => {
      if (store) void patchCanvas(store, id, { layout: { viewport } });
    }, 400),
    flushSpaces: debounce(() => {
      const s = flushState[id];
      if (!s || !store || Object.keys(s.pendingSpaces).length === 0) return;
      const layoutPatch: CanvasLayoutPatch = { spaces: s.pendingSpaces };
      s.pendingSpaces = {};
      void patchCanvas(store, id, { layout: layoutPatch });
    }, 200),
    flushAreas: debounce(() => {
      const s = flushState[id];
      if (!s || !store || !s.pendingAreas) return;
      const layoutPatch: CanvasLayoutPatch = { areas: s.pendingAreas };
      s.pendingAreas = null;
      void patchCanvas(store, id, { layout: layoutPatch });
    }, 200),
  };
  flushState[id] = state;
  return state;
}

export interface CanvasStoreApi {
  layout: CanvasLayout;
  loaded: boolean;
  draggingActive: boolean;
  draggingUid: string | null;
  draggingAreaId: string | null;
  carriedUids: Set<string>;
  carriedAreaIds: Set<string>;
  selectedUids: Set<string>;
  selectedAreaIds: Set<string>;

  fetchLayout: () => Promise<void>;
  applyServerLayout: (layout: CanvasLayout) => void;

  setDraggingActive: (v: boolean) => void;
  setDraggingUid: (uid: string | null) => void;
  setDraggingAreaId: (id: string | null) => void;
  setCarried: (uids: Set<string>, areaIds: Set<string>) => void;

  setSpaceLayout: (uid: string, layout: CanvasSpaceLayout | null) => void;
  patchSpaceLayout: (uid: string, patch: Partial<CanvasSpaceLayout>) => void;
  bulkPatchSpaceLayout: (entries: Record<string, Partial<CanvasSpaceLayout>>) => void;
  setViewport: (viewport: CanvasViewport) => void;
  setAreas: (areas: CanvasArea[]) => void;
  addArea: (area: CanvasArea) => void;
  patchArea: (id: string, patch: Partial<CanvasArea>) => void;
  removeArea: (id: string) => void;

  selectUid: (uid: string, additive?: boolean) => void;
  selectArea: (id: string, additive?: boolean) => void;
  clearSelection: () => void;

  __readLayout: () => CanvasLayout;
}

function buildApi(id: string): CanvasStoreApi {
  return {
    get layout() { return readInstance(id).layout; },
    get loaded() { return readInstance(id).loaded; },
    get draggingActive() { return readInstance(id).draggingActive; },
    get draggingUid() { return readInstance(id).draggingUid; },
    get draggingAreaId() { return readInstance(id).draggingAreaId; },
    get carriedUids() { return readInstance(id).carriedUids; },
    get carriedAreaIds() { return readInstance(id).carriedAreaIds; },
    get selectedUids() { return readInstance(id).selectedUids; },
    get selectedAreaIds() { return readInstance(id).selectedAreaIds; },

    fetchLayout: async () => {
      if (!store) return;
      try {
        const data = await getCanvas(store, id);
        if (data && data.layout) patchInstance(id, { layout: data.layout, loaded: true });
        else patchInstance(id, { layout: { ...DEFAULT_CANVAS_LAYOUT }, loaded: true });
      } catch {
        patchInstance(id, { loaded: true });
      }
    },

    applyServerLayout: (layout: CanvasLayout) => {
      if (readInstance(id).draggingActive) return;
      patchInstance(id, { layout });
    },

    setDraggingActive: (v) => patchInstance(id, { draggingActive: v }),
    setDraggingUid: (uid) => patchInstance(id, { draggingUid: uid }),
    setDraggingAreaId: (aid) => patchInstance(id, { draggingAreaId: aid }),
    setCarried: (uids, areaIds) => patchInstance(id, { carriedUids: uids, carriedAreaIds: areaIds }),

    setSpaceLayout: (uid, entry) => {
      const cur = readInstance(id);
      const next = { ...cur.layout.spaces };
      if (entry === null) delete next[uid];
      else next[uid] = entry;
      patchInstance(id, { layout: { ...cur.layout, spaces: next } });
      const fs = getFlushState(id);
      fs.pendingSpaces[uid] = entry;
      fs.flushSpaces();
    },

    patchSpaceLayout: (uid, patch) => {
      const cur = readInstance(id);
      const current = cur.layout.spaces[uid];
      if (!current) return;
      const merged: CanvasSpaceLayout = { ...current, ...patch };
      const next = { ...cur.layout.spaces, [uid]: merged };
      patchInstance(id, { layout: { ...cur.layout, spaces: next } });
      const fs = getFlushState(id);
      fs.pendingSpaces[uid] = merged;
      fs.flushSpaces();
    },

    bulkPatchSpaceLayout: (entries) => {
      const cur = readInstance(id);
      const next = { ...cur.layout.spaces };
      const fs = getFlushState(id);
      for (const [uid, patch] of Object.entries(entries)) {
        const current = next[uid];
        if (!current) continue;
        const merged: CanvasSpaceLayout = { ...current, ...patch };
        next[uid] = merged;
        fs.pendingSpaces[uid] = merged;
      }
      patchInstance(id, { layout: { ...cur.layout, spaces: next } });
      fs.flushSpaces();
    },

    setViewport: (viewport) => {
      const cur = readInstance(id);
      patchInstance(id, { layout: { ...cur.layout, viewport } });
      getFlushState(id).flushViewport(viewport);
    },

    setAreas: (areas) => {
      const cur = readInstance(id);
      patchInstance(id, { layout: { ...cur.layout, areas } });
      const fs = getFlushState(id);
      fs.pendingAreas = areas;
      fs.flushAreas();
    },

    addArea: (area) => {
      const cur = readInstance(id);
      const next = [...cur.layout.areas, area];
      patchInstance(id, { layout: { ...cur.layout, areas: next } });
      const fs = getFlushState(id);
      fs.pendingAreas = next;
      fs.flushAreas();
    },

    patchArea: (aid, patch) => {
      const cur = readInstance(id);
      const next = cur.layout.areas.map((a) => (a.id === aid ? { ...a, ...patch } : a));
      patchInstance(id, { layout: { ...cur.layout, areas: next } });
      const fs = getFlushState(id);
      fs.pendingAreas = next;
      fs.flushAreas();
    },

    removeArea: (aid) => {
      const cur = readInstance(id);
      const next = cur.layout.areas.filter((a) => a.id !== aid);
      patchInstance(id, { layout: { ...cur.layout, areas: next } });
      const fs = getFlushState(id);
      fs.pendingAreas = next;
      fs.flushAreas();
    },

    selectUid: (uid, additive = false) => {
      const cur = readInstance(id);
      let next: Set<string>;
      if (additive) {
        next = new Set(cur.selectedUids);
        if (next.has(uid)) next.delete(uid);
        else next.add(uid);
      } else {
        next = new Set([uid]);
      }
      patchInstance(id, { selectedUids: next, selectedAreaIds: additive ? cur.selectedAreaIds : new Set() });
    },

    selectArea: (aid, additive = false) => {
      const cur = readInstance(id);
      let next: Set<string>;
      if (additive) {
        next = new Set(cur.selectedAreaIds);
        if (next.has(aid)) next.delete(aid);
        else next.add(aid);
      } else {
        next = new Set([aid]);
      }
      patchInstance(id, { selectedAreaIds: next, selectedUids: additive ? cur.selectedUids : new Set() });
    },

    clearSelection: () => patchInstance(id, { selectedUids: new Set(), selectedAreaIds: new Set() }),

    __readLayout: () => readInstance(id).layout,
  };
}

const apiCache = new Map<string, CanvasStoreApi>();
function getApi(id: string): CanvasStoreApi {
  let api = apiCache.get(id);
  if (!api) {
    api = buildApi(id);
    apiCache.set(id, api);
  }
  return api;
}

export function useCanvasStore<T>(id: string, selector: (api: CanvasStoreApi) => T): T {
  const api = getApi(id);
  return useRoot((root) => {
    void root.instances[id];
    return selector(api);
  });
}

export interface CanvasListApi {
  list: CanvasInfo[];
  loaded: boolean;
  fetchList: () => Promise<void>;
  createCanvas: (name: string) => Promise<CanvasInfo>;
  renameCanvas: (id: string, name: string) => Promise<CanvasInfo>;
  deleteCanvas: (id: string) => Promise<void>;
}

const listApi: CanvasListApi = {
  get list() { return useRoot.getState().list; },
  get loaded() { return useRoot.getState().listLoaded; },
  fetchList: async () => {
    if (!store) return;
    try {
      useRoot.setState({ list: await listCanvases(store), listLoaded: true });
    } catch {
      useRoot.setState({ listLoaded: true });
    }
  },
  createCanvas: async (name: string) => {
    if (!store) throw new Error('Canvas store not initialized');
    const info = await createCanvas(store, name);
    await listApi.fetchList();
    return info;
  },
  renameCanvas: async (id: string, name: string) => {
    if (!store) throw new Error('Canvas store not initialized');
    const info = await renameCanvas(store, id, name);
    await listApi.fetchList();
    return info;
  },
  deleteCanvas: async (id: string) => {
    if (!store) throw new Error('Canvas store not initialized');
    await deleteCanvas(store, id);
    await listApi.fetchList();
  },
};

export function useCanvasList<T>(selector: (api: CanvasListApi) => T): T {
  return useRoot((root) => {
    void root.list;
    void root.listLoaded;
    return selector(listApi);
  });
}

export function useCanvasListRaw(): CanvasListApi {
  return listApi;
}
