import { memo, useRef, useState } from 'react';
import { useCanvasStore } from '../useCanvasStore';
import { useCanvasId } from './CanvasContext';
import { clientToCanvas } from '../geometry';

interface AreaProps {
  id: string;
  zIndex: number;
  canvasRootRef: React.RefObject<HTMLDivElement | null>;
}

const DRAG_THRESHOLD = 3;
const Z_DRAGGING = 99999;

function AreaInner({ id, zIndex, canvasRootRef }: AreaProps) {
  const canvasId = useCanvasId();
  const area = useCanvasStore(canvasId, (s) => s.layout.areas.find((a) => a.id === id));
  const isDragged = useCanvasStore(canvasId, (s) => s.draggingAreaId === id);
  const isCarried = useCanvasStore(canvasId, (s) => s.carriedAreaIds.has(id));
  const selected = useCanvasStore(canvasId, (s) => s.selectedAreaIds.has(id));
  const viewport = useCanvasStore(canvasId, (s) => s.layout.viewport);
  const selectArea = useCanvasStore(canvasId, (s) => s.selectArea);
  const patchArea = useCanvasStore(canvasId, (s) => s.patchArea);
  const patchSpaceLayout = useCanvasStore(canvasId, (s) => s.patchSpaceLayout);
  const setDraggingActive = useCanvasStore(canvasId, (s) => s.setDraggingActive);
  const setDraggingAreaId = useCanvasStore(canvasId, (s) => s.setDraggingAreaId);
  const setCarried = useCanvasStore(canvasId, (s) => s.setCarried);
  const readLayout = useCanvasStore(canvasId, (s) => s.__readLayout);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(area?.label ?? '');

  if (!area) return null;

  const suppressClickRef = useRef(false);

  type ChildSnapshot =
    | { kind: 'postit'; uid: string; startX: number; startY: number }
    | { kind: 'area'; id: string; startX: number; startY: number };
  const dragRef = useRef<{
    active: boolean; dragged: boolean;
    startX: number; startY: number;
    offsetX: number; offsetY: number;
    selfStartX: number; selfStartY: number;
    children: ChildSnapshot[];
  }>({
    active: false, dragged: false,
    startX: 0, startY: 0,
    offsetX: 0, offsetY: 0,
    selfStartX: 0, selfStartY: 0,
    children: [],
  });

  const snapshotContainedChildren = (): ChildSnapshot[] => {
    const layout = readLayout();
    if (!layout) return [];
    const parentL = area.x, parentT = area.y;
    const parentR = area.x + area.width, parentB = area.y + area.height;
    const out: ChildSnapshot[] = [];
    for (const [uid, sp] of Object.entries(layout.spaces)) {
      if (!sp) continue;
      if (sp.x >= parentL && sp.y >= parentT && sp.x + sp.width <= parentR && sp.y + sp.height <= parentB) {
        out.push({ kind: 'postit', uid, startX: sp.x, startY: sp.y });
      }
    }
    for (const a of layout.areas) {
      if (a.id === id) continue;
      if (a.x >= parentL && a.y >= parentT && a.x + a.width <= parentR && a.y + a.height <= parentB) {
        out.push({ kind: 'area', id: a.id, startX: a.x, startY: a.y });
      }
    }
    return out;
  };

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    if (!canvasRootRef.current) return;
    const rect = canvasRootRef.current.getBoundingClientRect();
    const p = clientToCanvas(e.clientX, e.clientY, rect, viewport);
    const children = snapshotContainedChildren();
    dragRef.current = {
      active: true, dragged: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: p.x - area.x, offsetY: p.y - area.y,
      selfStartX: area.x, selfStartY: area.y,
      children,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active || !canvasRootRef.current) return;
    if (!dragRef.current.dragged) {
      const dist = Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY);
      if (dist < DRAG_THRESHOLD) return;
      dragRef.current.dragged = true;
      setDraggingActive(true);
      setDraggingAreaId(id);
      const carriedUids = new Set<string>();
      const carriedAreaIds = new Set<string>();
      for (const c of dragRef.current.children) {
        if (c.kind === 'postit') carriedUids.add(c.uid);
        else carriedAreaIds.add(c.id);
      }
      setCarried(carriedUids, carriedAreaIds);
    }
    const rect = canvasRootRef.current.getBoundingClientRect();
    const p = clientToCanvas(e.clientX, e.clientY, rect, viewport);
    const nextX = p.x - dragRef.current.offsetX;
    const nextY = p.y - dragRef.current.offsetY;
    const dx = nextX - dragRef.current.selfStartX;
    const dy = nextY - dragRef.current.selfStartY;
    patchArea(id, { x: nextX, y: nextY });
    for (const child of dragRef.current.children) {
      if (child.kind === 'postit') {
        patchSpaceLayout(child.uid, { x: child.startX + dx, y: child.startY + dy });
      } else {
        patchArea(child.id, { x: child.startX + dx, y: child.startY + dy });
      }
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    if (dragRef.current.dragged) {
      suppressClickRef.current = true;
      setDraggingActive(false);
      setDraggingAreaId(null);
      setCarried(new Set(), new Set());
    }
    dragRef.current.active = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const resizeRef = useRef<{ active: boolean; startW: number; startH: number; startX: number; startY: number }>({
    active: false, startW: 0, startH: 0, startX: 0, startY: 0,
  });
  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = true;
    setDraggingActive(true);
    setDraggingAreaId(id);
    resizeRef.current = { active: true, startW: area.width, startH: area.height, startX: e.clientX, startY: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current.active) return;
    const dx = (e.clientX - resizeRef.current.startX) / viewport.zoom;
    const dy = (e.clientY - resizeRef.current.startY) / viewport.zoom;
    patchArea(id, {
      width: Math.max(120, resizeRef.current.startW + dx),
      height: Math.max(80, resizeRef.current.startH + dy),
    });
  };
  const endResize = (e: React.PointerEvent) => {
    if (!resizeRef.current.active) return;
    resizeRef.current.active = false;
    setDraggingActive(false);
    setDraggingAreaId(null);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const commitLabel = () => {
    if (draftLabel !== area.label) patchArea(id, { label: draftLabel });
    setEditing(false);
  };

  const onAreaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    selectArea(id, additive);
  };

  const effectiveZ = isDragged ? Z_DRAGGING : (isCarried ? Z_DRAGGING + 1 : zIndex);
  const variant = area.variant || 'banner';
  const toggleVariant = (e: React.MouseEvent) => {
    e.stopPropagation();
    patchArea(id, { variant: variant === 'postit' ? 'banner' : 'postit' });
  };

  const defaultFontColor = variant === 'postit' ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.92)';
  const effectiveFontColor = area.fontColor || defaultFontColor;

  return (
    <div
      className={`canvas-area canvas-area-${variant} ${selected ? 'canvas-area-selected' : ''}`}
      style={{
        left: area.x, top: area.y,
        width: area.width, height: area.height,
        zIndex: effectiveZ,
        background: area.color,
        color: effectiveFontColor,
      }}
      onClick={onAreaClick}
    >
      {selected && (
        <button
          className="canvas-area-variant-toggle"
          onClick={toggleVariant}
          onPointerDown={(e) => e.stopPropagation()}
          title={variant === 'postit'
            ? 'Switch to Area form (banner + notes)'
            : 'Switch to Sticky form (centred label, no chrome)'}
        >
          {variant === 'postit' ? 'A' : 'S'}
        </button>
      )}
      {variant === 'postit' ? (
        editing ? (
          <input
            autoFocus
            className="canvas-area-postit-input"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') { setDraftLabel(area.label); setEditing(false); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="canvas-area-postit-text"
            onPointerDown={startDrag}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftLabel(area.label);
              setEditing(true);
            }}
          >
            {area.label || 'Area'}
          </div>
        )
      ) : (
        <>
          {editing ? (
            <input
              autoFocus
              className="canvas-area-title-input"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLabel();
                if (e.key === 'Escape') { setDraftLabel(area.label); setEditing(false); }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className="canvas-area-title"
              onPointerDown={startDrag}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraftLabel(area.label);
                setEditing(true);
              }}
            >
              {area.label || 'Area'}
            </div>
          )}
          <textarea
            className="canvas-area-notes"
            value={area.notes || ''}
            placeholder={selected ? 'Notes...' : ''}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => patchArea(id, { notes: e.target.value })}
            spellCheck={false}
          />
        </>
      )}
      <div
        className="canvas-area-resize"
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        title="Drag to resize"
      />
    </div>
  );
}

export const Area = memo(AreaInner);
