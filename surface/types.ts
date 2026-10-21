export interface CanvasSpaceLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  color: string | null;
  fontColor: string | null;
}

export interface CanvasArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  label: string;
  color: string;
  fontColor?: string | null;
  notes?: string;
  variant?: 'banner' | 'postit';
}

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CanvasLayout {
  version: number;
  viewport: CanvasViewport;
  spaces: Record<string, CanvasSpaceLayout>;
  areas: CanvasArea[];
}

export interface CanvasLayoutPatch {
  viewport?: CanvasViewport;
  spaces?: Record<string, CanvasSpaceLayout | null>;
  areas?: CanvasArea[];
}

export interface CanvasInfo {
  id: string;
  name: string;
}

export interface CanvasMeta {
  name: string;
}

export interface CanvasEntityValue {
  name: string;
  layout: CanvasLayout;
}

export interface PostitColors {
  background: string;
  fontColor: string;
  borderColor: string;
}
