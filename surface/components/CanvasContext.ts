import { createContext, useContext } from 'react';

// CanvasView always supplies the real id through the Provider; this empty
// default only covers a child rendered with no canvas selected.
export const CanvasIdContext = createContext<string>('');

export function useCanvasId(): string {
  return useContext(CanvasIdContext);
}
