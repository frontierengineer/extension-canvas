import type { CanvasLayout, PostitColors } from './types';

export const DEFAULT_CANVAS_LAYOUT: CanvasLayout = {
  version: 1,
  viewport: { zoom: 1, panX: 0, panY: 0 },
  spaces: {},
  areas: [],
};

export const AREA_PALETTE: string[] = [
  '#5a4a1f',
  '#1f5a3a',
  '#1f3a5a',
  '#5a2a2a',
  '#4a2a5a',
  '#5a3a1f',
];

export const DEFAULT_POSTIT_COLORS: PostitColors = {
  background: 'color-mix(in srgb, var(--accent) 18%, var(--bg-secondary))',
  fontColor: 'var(--text-primary)',
  borderColor: 'var(--accent)',
};
