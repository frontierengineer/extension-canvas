import type { CanvasSpaceLayout, CanvasArea, CanvasViewport } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function isContainedWithin(
  child: { x: number; y: number; width: number; height: number },
  parent: { x: number; y: number; width: number; height: number },
): boolean {
  if (child.x < parent.x) return false;
  if (child.y < parent.y) return false;
  if (child.x + child.width > parent.x + parent.width) return false;
  if (child.y + child.height > parent.y + parent.height) return false;
  if (
    child.x === parent.x &&
    child.y === parent.y &&
    child.width === parent.width &&
    child.height === parent.height
  ) return false;
  return true;
}

export function postitIsContainer(
  uid: string,
  layout: CanvasSpaceLayout,
  all: Record<string, CanvasSpaceLayout>,
): boolean {
  for (const [otherUid, other] of Object.entries(all)) {
    if (otherUid === uid) continue;
    if (isContainedWithin(other, layout)) return true;
  }
  return false;
}

export function bordersCrossed(a: Rect, b: Rect): number {
  const horizontalCrossesB = (y: number, x1: number, x2: number): boolean =>
    y > b.y && y < b.y + b.height && x2 > b.x && x1 < b.x + b.width;
  const verticalCrossesB = (x: number, y1: number, y2: number): boolean =>
    x > b.x && x < b.x + b.width && y2 > b.y && y1 < b.y + b.height;
  let n = 0;
  if (horizontalCrossesB(a.y, a.x, a.x + a.width)) n++;
  if (horizontalCrossesB(a.y + a.height, a.x, a.x + a.width)) n++;
  if (verticalCrossesB(a.x, a.y, a.y + a.height)) n++;
  if (verticalCrossesB(a.x + a.width, a.y, a.y + a.height)) n++;
  return n;
}

export function isInFrontOf(a: Rect, b: Rect): boolean {
  if (isContainedWithin(a, b)) return true;
  if (isContainedWithin(b, a)) return false;
  if (rectsIntersect(a, b)) {
    const aCross = bordersCrossed(a, b);
    const bCross = bordersCrossed(b, a);
    if (aCross !== bCross) return aCross > bCross;
  }
  if (a.y !== b.y) return a.y > b.y;
  return false;
}

export function zScore<T extends Rect>(item: T, all: readonly T[]): number {
  let count = 0;
  for (const other of all) {
    if (other === item) continue;
    if (isInFrontOf(item, other)) count++;
  }
  return count;
}

export function clientToCanvas(
  clientX: number,
  clientY: number,
  rootRect: DOMRect,
  viewport: CanvasViewport,
): { x: number; y: number } {
  return {
    x: (clientX - rootRect.left) / viewport.zoom - viewport.panX,
    y: (clientY - rootRect.top) / viewport.zoom - viewport.panY,
  };
}

export function visibleRect(
  rootRect: DOMRect,
  viewport: CanvasViewport,
): Rect {
  return {
    x: -viewport.panX,
    y: -viewport.panY,
    width: rootRect.width / viewport.zoom,
    height: rootRect.height / viewport.zoom,
  };
}

export function boundsOf(
  spaces: Record<string, CanvasSpaceLayout>,
  areas: CanvasArea[],
): Rect | null {
  const items: Rect[] = [];
  for (const s of Object.values(spaces)) items.push(s);
  for (const a of areas) items.push(a);
  if (items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    if (it.x < minX) minX = it.x;
    if (it.y < minY) minY = it.y;
    if (it.x + it.width > maxX) maxX = it.x + it.width;
    if (it.y + it.height > maxY) maxY = it.y + it.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function newAreaId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `area_${Date.now().toString(36)}_${rand}`;
}
