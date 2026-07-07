import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../useCanvasStore';
import { useCanvasId } from './CanvasContext';
import type { CanvasViewport } from '../types';
import { boundsOf } from '../geometry';

interface MinimapProps {
  canvasWidth: number;
  canvasHeight: number;
  onPan?: (viewport: CanvasViewport) => void;
}

const MINIMAP_W = 200;
const MINIMAP_H = 140;

export function Minimap({ canvasWidth, canvasHeight, onPan }: MinimapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const canvasId = useCanvasId();
  const spaces = useCanvasStore(canvasId, (s) => s.layout.spaces);
  const areas = useCanvasStore(canvasId, (s) => s.layout.areas);
  const viewport = useCanvasStore(canvasId, (s) => s.layout.viewport);
  const setViewport = useCanvasStore(canvasId, (s) => s.setViewport);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = MINIMAP_W;
    canvas.height = MINIMAP_H;
    ctx.fillStyle = 'rgba(20, 22, 28, 0.85)';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    const bounds = boundsOf(spaces, areas);
    if (!bounds) return;
    const PADDING = 80;
    bounds.x -= PADDING;
    bounds.y -= PADDING;
    bounds.width += PADDING * 2;
    bounds.height += PADDING * 2;
    const scale = Math.min(MINIMAP_W / bounds.width, MINIMAP_H / bounds.height) * 0.95;
    const offsetX = (MINIMAP_W - bounds.width * scale) / 2;
    const offsetY = (MINIMAP_H - bounds.height * scale) / 2;

    for (const a of areas) {
      ctx.fillStyle = a.color;
      ctx.fillRect((a.x - bounds.x) * scale + offsetX, (a.y - bounds.y) * scale + offsetY, a.width * scale, a.height * scale);
    }
    for (const s of Object.values(spaces)) {
      ctx.fillStyle = s.color || '#6366f1';
      ctx.fillRect((s.x - bounds.x) * scale + offsetX, (s.y - bounds.y) * scale + offsetY, s.width * scale, s.height * scale);
    }

    const vpW = canvasWidth / viewport.zoom;
    const vpH = canvasHeight / viewport.zoom;
    const vpX = -viewport.panX;
    const vpY = -viewport.panY;
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect((vpX - bounds.x) * scale + offsetX, (vpY - bounds.y) * scale + offsetY, vpW * scale, vpH * scale);
  }, [spaces, areas, viewport, canvasWidth, canvasHeight]);

  const handleClick = (e: React.MouseEvent) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const bounds = boundsOf(spaces, areas);
    if (!bounds) return;
    const PADDING = 80;
    const b = { x: bounds.x - PADDING, y: bounds.y - PADDING, width: bounds.width + PADDING * 2, height: bounds.height + PADDING * 2 };
    const scale = Math.min(MINIMAP_W / b.width, MINIMAP_H / b.height) * 0.95;
    const offsetX = (MINIMAP_W - b.width * scale) / 2;
    const offsetY = (MINIMAP_H - b.height * scale) / 2;
    const cx = (mx - offsetX) / scale + b.x;
    const cy = (my - offsetY) / scale + b.y;
    const next: CanvasViewport = {
      zoom: viewport.zoom,
      panX: -(cx - canvasWidth / viewport.zoom / 2),
      panY: -(cy - canvasHeight / viewport.zoom / 2),
    };
    setViewport(next);
    onPan?.(next);
  };

  return (
    <canvas
      ref={ref}
      className="canvas-minimap"
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
      onClick={handleClick}
    />
  );
}
