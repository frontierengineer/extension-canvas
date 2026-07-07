import { memo, useEffect, useRef } from 'react';
import { useCanvasStore } from '../useCanvasStore';
import { useCanvasId } from './CanvasContext';
import { DEFAULT_POSTIT_COLORS } from '../constants';
import { clientToCanvas } from '../geometry';

interface PostitProps {
  uid: string;
  isContainer: boolean;
  zIndex: number;
  canvasRootRef: React.RefObject<HTMLDivElement | null>;
}

const DRAG_THRESHOLD = 3;
const Z_DRAGGING = 99999;

function PostitInner({ uid, isContainer, zIndex, canvasRootRef }: PostitProps) {
  const canvasId = useCanvasId();

  const layout = useCanvasStore(canvasId, (s) => s.layout.spaces[uid]);
  const isDragged = useCanvasStore(canvasId, (s) => s.draggingUid === uid);
  const isCarried = useCanvasStore(canvasId, (s) => s.carriedUids.has(uid));
  const selected = useCanvasStore(canvasId, (s) => s.selectedUids.has(uid));
  const viewport = useCanvasStore(canvasId, (s) => s.layout.viewport);
  const selectUid = useCanvasStore(canvasId, (s) => s.selectUid);
  const patchSpaceLayout = useCanvasStore(canvasId, (s) => s.patchSpaceLayout);
  const setDraggingActive = useCanvasStore(canvasId, (s) => s.setDraggingActive);
  const setDraggingUid = useCanvasStore(canvasId, (s) => s.setDraggingUid);

  if (!layout) return null;

  const background = layout.color || DEFAULT_POSTIT_COLORS.background;
  const fontColor = layout.fontColor || DEFAULT_POSTIT_COLORS.fontColor;
  const borderColor = DEFAULT_POSTIT_COLORS.borderColor;
  const effectiveZ = isDragged ? Z_DRAGGING : (isCarried ? Z_DRAGGING + 1 : zIndex);

  const suppressClickRef = useRef(false);

  const dragRef = useRef<{ active: boolean; dragged: boolean; startX: number; startY: number; offsetX: number; offsetY: number }>({
    active: false, dragged: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0,
  });
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!canvasRootRef.current) return;
    const rect = canvasRootRef.current.getBoundingClientRect();
    const p = clientToCanvas(e.clientX, e.clientY, rect, viewport);
    dragRef.current = {
      active: true, dragged: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: p.x - layout.x, offsetY: p.y - layout.y,
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
      setDraggingUid(uid);
    }
    const rect = canvasRootRef.current.getBoundingClientRect();
    const p = clientToCanvas(e.clientX, e.clientY, rect, viewport);
    patchSpaceLayout(uid, { x: p.x - dragRef.current.offsetX, y: p.y - dragRef.current.offsetY });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    if (dragRef.current.dragged) {
      suppressClickRef.current = true;
      setDraggingActive(false);
      setDraggingUid(null);
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
    setDraggingUid(uid);
    resizeRef.current = {
      active: true,
      startW: layout.width, startH: layout.height,
      startX: e.clientX, startY: e.clientY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current.active) return;
    const dx = (e.clientX - resizeRef.current.startX) / viewport.zoom;
    const dy = (e.clientY - resizeRef.current.startY) / viewport.zoom;
    patchSpaceLayout(uid, {
      width: Math.max(60, resizeRef.current.startW + dx),
      height: Math.max(40, resizeRef.current.startH + dy),
    });
  };
  const endResize = (e: React.PointerEvent) => {
    if (!resizeRef.current.active) return;
    resizeRef.current.active = false;
    setDraggingActive(false);
    setDraggingUid(null);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const isAdditive = (e: React.MouseEvent) => e.shiftKey || e.metaKey || e.ctrlKey;
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    selectUid(uid, isAdditive(e));
  };

  const titleText = uid;

  return (
    <div
      className={[
        'canvas-postit',
        selected ? 'canvas-postit-selected' : '',
        isContainer ? 'canvas-postit-container' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: layout.x, top: layout.y,
        width: layout.width, height: layout.height,
        zIndex: effectiveZ,
        background, color: fontColor, borderColor,
      }}
      title={titleText}
      onPointerDown={startDrag}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={handleClick}
    >
      <div
        className="canvas-postit-title canvas-postit-title-centered"
        style={{ color: fontColor }}
      >
        <span className="canvas-postit-title-text">
          {titleText}
        </span>
      </div>
      <div
        className="canvas-postit-resize"
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        title="Drag to resize"
      />
    </div>
  );
}

export const Postit = memo(PostitInner);
