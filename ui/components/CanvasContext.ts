import { createContext, useContext } from 'react';
import { DEFAULT_CANVAS_ID } from '../constants';

export const CanvasIdContext = createContext<string>(DEFAULT_CANVAS_ID);

export function useCanvasId(): string {
  return useContext(CanvasIdContext);
}
