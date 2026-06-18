import { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore, useCanvasList } from '../useCanvasStore';
import { CanvasIdContext } from './CanvasContext';
import { DEFAULT_CANVAS_ID } from '../constants';
import type { CanvasSpaceLayout } from '../types';
import { Postit } from './Postit';
import { Area } from './Area';
import { Minimap } from './Minimap';
import { clientToCanvas, newAreaId, rectsIntersect, visibleRect, zScore } from '../geometry';
import { AREA_PALETTE } from '../constants';
import type { Rect } from '../geometry';

function splitColor(c: string | null, fallback: string): { rgb: string; alpha: number } {
  if (!c) return { rgb: fallback, alpha: 1 };
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return { rgb: c.toLowerCase(), alpha: 1 };
  if (/^#[0-9a-fA-F]{8}$/.test(c)) {
    return {
      rgb: c.slice(0, 7).toLowerCase(),
      alpha: parseInt(c.slice(7, 9), 16) / 255,
    };
  }
  return { rgb: fallback, alpha: 1 };
}

function combineColor(rgb: string, alpha: number): string {
  if (alpha >= 0.999) return rgb;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16).padStart(2, '0');
  return `${rgb}${a}`;
}

function AlphaColor({
  value, fallback, onChange, title,
}: {
  value: string | null;
  fallback: string;
  onChange: (next: string) => void;
  title: string;
}) {
  const { rgb, alpha } = splitColor(value, fallback);
  const onRgb = (e: React.ChangeEvent<HTMLInputElement>) => onChange(combineColor(e.target.value, alpha));
  const onAlpha = (e: React.ChangeEvent<HTMLInputElement>) => onChange(combineColor(rgb, parseInt(e.target.value, 10) / 100));
  return (
    <div className="canvas-color-pair" title={title}>
      <input type="color" value={rgb} onChange={onRgb} className="canvas-color-swatch" />
      <input
        type="range" min={0} max={100} step={1}
        value={Math.round(alpha * 100)}
        onChange={onAlpha}
        className="canvas-color-alpha"
        title={`Alpha ${Math.round(alpha * 100)}%`}
      />
    </div>
  );
}

function CanvasToolbarTitle({
  canvasId, name, onRename,
}: {
  canvasId: string;
  name: string;
  onRename: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(name); setEditing(false); }, [canvasId, name]);

  if (!editing) {
    return (
      <div
        className="canvas-toolbar-title canvas-toolbar-title-editable"
        title="Click to rename"
        onClick={() => { setDraft(name); setEditing(true); }}
      >
        {name}
      </div>
    );
  }

  const commit = () => {
    setEditing(false);
    void onRename(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(name);
  };
  return (
    <input
      ref={inputRef}
      className="canvas-toolbar-title canvas-toolbar-title-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
    />
  );
}

export function CanvasView({ canvasId = DEFAULT_CANVAS_ID }: { canvasId?: string }) {
  const list = useCanvasList((a) => a.list);
  const listLoaded = useCanvasList((a) => a.loaded);
  const fetchList = useCanvasList((a) => a.fetchList);
  const renameCanvas = useCanvasList((a) => a.renameCanvas);
  const layout = useCanvasStore(canvasId, (s) => s.layout);
  const loaded = useCanvasStore(canvasId, (s) => s.loaded);
  const fetchLayout = useCanvasStore(canvasId, (s) => s.fetchLayout);
  const setViewport = useCanvasStore(canvasId, (s) => s.setViewport);
  const setSpaceLayout = useCanvasStore(canvasId, (s) => s.setSpaceLayout);
  const patchSpaceLayout = useCanvasStore(canvasId, (s) => s.patchSpaceLayout);
  const addArea = useCanvasStore(canvasId, (s) => s.addArea);
  const patchArea = useCanvasStore(canvasId, (s) => s.patchArea);
  const removeArea = useCanvasStore(canvasId, (s) => s.removeArea);
  const clearSelection = useCanvasStore(canvasId, (s) => s.clearSelection);
  const selectUid = useCanvasStore(canvasId, (s) => s.selectUid);
  const selectedUids = useCanvasStore(canvasId, (s) => s.selectedUids);
  const selectedAreaIds = useCanvasStore(canvasId, (s) => s.selectedAreaIds);
  const draggingUid = useCanvasStore(canvasId, (s) => s.draggingUid);
  const draggingAreaId = useCanvasStore(canvasId, (s) => s.draggingAreaId);
  const canvasInfo = list.find((c) => c.id === canvasId);
  const canvasName = canvasInfo?.name || (canvasId === DEFAULT_CANVAS_ID ? 'Canvas' : canvasId);

  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });

  useEffect(() => { fetchLayout(); }, [fetchLayout, canvasId]);
  useEffect(() => { if (!listLoaded) fetchList(); }, [listLoaded, fetchList]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setRootSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const panRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false, startX: 0, startY: 0, baseX: 0, baseY: 0,
  });
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.matches?.('input,textarea,[contenteditable]')) setSpaceDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const middle = e.button === 1;
    const leftWithSpace = e.button === 0 && spaceDown;
    if (!middle && !leftWithSpace) return;
    e.preventDefault();
    panRef.current = {
      active: true,
      startX: e.clientX, startY: e.clientY,
      baseX: layout.viewport.panX, baseY: layout.viewport.panY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panRef.current.active) return;
    const dx = (e.clientX - panRef.current.startX) / layout.viewport.zoom;
    const dy = (e.clientY - panRef.current.startY) / layout.viewport.zoom;
    setViewport({ ...layout.viewport, panX: panRef.current.baseX + dx, panY: panRef.current.baseY + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const zoomKey = e.ctrlKey || e.metaKey;
      e.preventDefault();
      if (zoomKey) {
        const rect = el.getBoundingClientRect();
        const before = clientToCanvas(e.clientX, e.clientY, rect, layout.viewport);
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextZoom = Math.max(0.15, Math.min(3, layout.viewport.zoom * factor));
        const after = clientToCanvas(e.clientX, e.clientY, rect, { ...layout.viewport, zoom: nextZoom });
        setViewport({
          zoom: nextZoom,
          panX: layout.viewport.panX + (after.x - before.x),
          panY: layout.viewport.panY + (after.y - before.y),
        });
      } else {
        setViewport({
          zoom: layout.viewport.zoom,
          panX: layout.viewport.panX - e.deltaX / layout.viewport.zoom,
          panY: layout.viewport.panY - e.deltaY / layout.viewport.zoom,
        });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as any);
  }, [layout.viewport, setViewport]);

  const onCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) clearSelection();
  };

  // Drop handler: accepts a UID via custom MIME type and places a postit.
  const onDrop = (e: React.DragEvent) => {
    if (!rootRef.current) return;
    const uid = e.dataTransfer.getData('extension/x-frontier-uid');
    if (!uid) return;
    e.preventDefault();
    e.stopPropagation();
    if (layout.spaces[uid]) {
      selectUid(uid, false);
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    const p = clientToCanvas(e.clientX, e.clientY, rect, layout.viewport);
    setSpaceLayout(uid, {
      x: p.x - 70, y: p.y - 50,
      width: 140, height: 100,
      zIndex: 0,
      color: null, fontColor: null,
    });
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('extension/x-frontier-uid')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  // Build positioned postits from layout.spaces directly (no tree dependency).
  const positionedUids = useMemo(() => Object.keys(layout.spaces), [layout.spaces]);

  type OrderedPostit = { uid: string; isContainer: boolean; zIndex: number };
  type OrderedArea = { id: string; zIndex: number };
  const sortCacheRef = useRef<{ postits: OrderedPostit[]; areas: OrderedArea[] } | null>(null);

  const dragging = draggingUid !== null || draggingAreaId !== null;

  const { postits: orderedPostits, areas: orderedAreas } = useMemo(() => {
    if (dragging && sortCacheRef.current) return sortCacheRef.current;

    const allRects: Rect[] = [];
    for (const s of Object.values(layout.spaces)) allRects.push(s);
    for (const a of layout.areas) allRects.push(a);

    const spaceEntries = Object.entries(layout.spaces);
    const containerSet = new Set<string>();
    for (const [uid, sp] of spaceEntries) {
      for (const [otherUid, other] of spaceEntries) {
        if (otherUid === uid) continue;
        if (
          other.x > sp.x && other.y > sp.y &&
          other.x + other.width < sp.x + sp.width &&
          other.y + other.height < sp.y + sp.height
        ) {
          containerSet.add(uid);
          break;
        }
      }
    }

    type ScoredItem =
      | { kind: 'postit'; uid: string; isContainer: boolean; score: number }
      | { kind: 'area'; id: string; score: number };
    const scored: ScoredItem[] = [];
    for (const uid of positionedUids) {
      const sp = layout.spaces[uid];
      if (!sp) continue;
      scored.push({
        kind: 'postit',
        uid,
        isContainer: containerSet.has(uid),
        score: zScore(sp, allRects),
      });
    }
    for (const a of layout.areas) {
      scored.push({ kind: 'area', id: a.id, score: zScore(a, allRects) });
    }
    scored.sort((a, b) => a.score - b.score);

    const postits: OrderedPostit[] = [];
    const areas: OrderedArea[] = [];
    scored.forEach((it, idx) => {
      const zIndex = 1 + idx;
      if (it.kind === 'postit') {
        postits.push({ uid: it.uid, isContainer: it.isContainer, zIndex });
      } else {
        areas.push({ id: it.id, zIndex });
      }
    });

    const next = { postits, areas };
    sortCacheRef.current = next;
    return next;
  }, [dragging, positionedUids, layout.spaces, layout.areas]);

  const visibleSet = useMemo(() => {
    if (!rootSize.width || !rootSize.height) return new Set(positionedUids);
    const rect = new DOMRect(0, 0, rootSize.width, rootSize.height);
    const vis = visibleRect(rect, layout.viewport);
    const margin = 400 / layout.viewport.zoom;
    const expanded: Rect = { x: vis.x - margin, y: vis.y - margin, width: vis.width + margin * 2, height: vis.height + margin * 2 };
    const out = new Set<string>();
    for (const uid of positionedUids) {
      const s = layout.spaces[uid];
      if (!s) continue;
      if (rectsIntersect(s, expanded as Rect)) out.add(uid);
    }
    return out;
  }, [positionedUids, layout.spaces, layout.viewport, rootSize]);

  const handleAddArea = () => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const centre = clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, layout.viewport);
    const color = AREA_PALETTE[layout.areas.length % AREA_PALETTE.length];
    addArea({
      id: newAreaId(),
      x: centre.x - 160, y: centre.y - 120,
      width: 320, height: 240,
      zIndex: 0,
      label: 'New area',
      color,
      variant: 'banner',
    });
  };

  const handleAddSticky = () => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const centre = clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, layout.viewport);
    const color = AREA_PALETTE[layout.areas.length % AREA_PALETTE.length];
    addArea({
      id: newAreaId(),
      x: centre.x - 70, y: centre.y - 50,
      width: 140, height: 100,
      zIndex: 0,
      label: 'New sticky',
      color,
      variant: 'postit',
    });
  };

  const selectedUid = selectedUids.size === 1 ? Array.from(selectedUids)[0] : null;
  const selectedAreaId = selectedAreaIds.size === 1 ? Array.from(selectedAreaIds)[0] : null;
  const selectedPostit = selectedUid ? layout.spaces[selectedUid] : null;
  const selectedArea = selectedAreaId ? layout.areas.find((a) => a.id === selectedAreaId) || null : null;

  const cyclePostitColour = () => {
    if (!selectedUid || !selectedPostit) return;
    const currentBg = selectedPostit.color?.slice(0, 7).toLowerCase() ?? null;
    let idx = AREA_PALETTE.findIndex((c) => c.toLowerCase() === currentBg);
    idx = (idx + 1) % AREA_PALETTE.length;
    patchSpaceLayout(selectedUid, { color: AREA_PALETTE[idx], fontColor: 'var(--text-primary)' });
  };
  const cycleAreaColour = () => {
    if (!selectedAreaId || !selectedArea) return;
    const currentBg = selectedArea.color.slice(0, 7).toLowerCase();
    let idx = AREA_PALETTE.findIndex((p) => p.toLowerCase() === currentBg);
    idx = (idx + 1) % AREA_PALETTE.length;
    patchArea(selectedAreaId, { color: AREA_PALETTE[idx] });
  };

  const removeSelectedPostit = () => {
    if (!selectedUid) return;
    setSpaceLayout(selectedUid, null);
    clearSelection();
  };
  const removeSelectedArea = () => {
    if (!selectedAreaId) return;
    removeArea(selectedAreaId);
    clearSelection();
  };

  const transform = `scale(${layout.viewport.zoom}) translate(${layout.viewport.panX}px, ${layout.viewport.panY}px)`;
  const platformMod = typeof navigator !== 'undefined' && navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl';

  return (
    <CanvasIdContext.Provider value={canvasId}>
    <div className="canvas-view">
      <div className="canvas-toolbar">
        <CanvasToolbarTitle
          canvasId={canvasId}
          name={canvasName}
          onRename={async (next) => {
            const trimmed = next.trim();
            if (!trimmed || trimmed === canvasName) return;
            await renameCanvas(canvasId, trimmed);
          }}
        />
        <div className="canvas-toolbar-hint">
          Scroll to pan · {platformMod}+Scroll to zoom
        </div>
        <div className="canvas-toolbar-spacer" />

        {selectedPostit && selectedUid && (
          <div className="canvas-toolbar-selection" title="Editing selected postit">
            <button className="canvas-toolbar-btn" onClick={cyclePostitColour} title="Cycle through preset palette">
              🖌
            </button>
            <label className="canvas-color-label" title="Background colour swatch + alpha slider">
              <span className="canvas-color-label-text">bg</span>
              <AlphaColor
                value={selectedPostit.color}
                fallback="#ffff88"
                onChange={(c) => patchSpaceLayout(selectedUid, { color: c })}
                title="Background colour"
              />
            </label>
            <label className="canvas-color-label" title="Text colour swatch + alpha slider">
              <span className="canvas-color-label-text">tx</span>
              <AlphaColor
                value={selectedPostit.fontColor}
                fallback="#000000"
                onChange={(c) => patchSpaceLayout(selectedUid, { fontColor: c })}
                title="Text colour"
              />
            </label>
            <button
              className="canvas-toolbar-btn"
              onClick={() => patchSpaceLayout(selectedUid, { color: null, fontColor: null })}
              title="Reset to default palette"
            >
              ↺
            </button>
            <button className="canvas-toolbar-btn canvas-toolbar-btn-danger" onClick={removeSelectedPostit} title="Remove postit from canvas">
              🗑
            </button>
          </div>
        )}

        {selectedArea && selectedAreaId && (
          <div className="canvas-toolbar-selection" title="Editing selected area">
            <button className="canvas-toolbar-btn" onClick={cycleAreaColour} title="Cycle through preset palette">
              🖌
            </button>
            <label className="canvas-color-label" title="Background colour swatch + alpha slider">
              <span className="canvas-color-label-text">bg</span>
              <AlphaColor
                value={selectedArea.color}
                fallback="#5a4a1f"
                onChange={(c) => patchArea(selectedAreaId, { color: c })}
                title="Area colour"
              />
            </label>
            <label className="canvas-color-label" title="Text colour swatch + alpha slider (overrides the contrast default)">
              <span className="canvas-color-label-text">tx</span>
              <AlphaColor
                value={selectedArea.fontColor || null}
                fallback="#ffffff"
                onChange={(c) => patchArea(selectedAreaId, { fontColor: c })}
                title="Text colour"
              />
            </label>
            <button className="canvas-toolbar-btn canvas-toolbar-btn-danger" onClick={removeSelectedArea} title="Delete area">
              🗑
            </button>
          </div>
        )}

        <button className="canvas-toolbar-btn" onClick={handleAddArea} title="Add a new area (banner header + notes body)">+ Area</button>
        <button className="canvas-toolbar-btn" onClick={handleAddSticky} title="Add a new sticky (centred label, no notes; switchable to area via the per-tile toggle)">+ Sticky</button>
        <button
          className="canvas-toolbar-btn"
          title="Reset view"
          onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
        >
          Reset view
        </button>
        <div className="canvas-toolbar-zoom">{Math.round(layout.viewport.zoom * 100)}%</div>
      </div>

      <div
        ref={rootRef}
        className={`canvas-root ${spaceDown ? 'canvas-root-pan' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onCanvasClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <div
          ref={innerRef}
          className="canvas-inner"
          style={{ transform, transformOrigin: '0 0' }}
        >
          {orderedAreas.map(({ id, zIndex }) => (
            <Area key={id} id={id} zIndex={zIndex} canvasRootRef={rootRef} />
          ))}
          {orderedPostits.map(({ uid, isContainer, zIndex }) => {
            if (!visibleSet.has(uid)) return null;
            return (
              <Postit
                key={uid}
                uid={uid}
                isContainer={isContainer}
                zIndex={zIndex}
                canvasRootRef={rootRef}
              />
            );
          })}
        </div>

        {loaded && positionedUids.length === 0 && layout.areas.length === 0 && (
          <div className="canvas-empty">
            <div className="canvas-empty-title">Nothing placed yet</div>
            <div className="canvas-empty-body">
              Use the + Area and + Sticky buttons in the toolbar to start building your canvas.
            </div>
          </div>
        )}

        <Minimap canvasWidth={rootSize.width} canvasHeight={rootSize.height} />
      </div>
    </div>
    </CanvasIdContext.Provider>
  );
}
