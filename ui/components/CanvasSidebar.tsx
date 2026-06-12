import { useEffect, type ReactElement } from 'react';
import { usePreviewClick } from '@frontierengineer/ui';
import { useCanvasList } from '../useCanvasStore';
import { DEFAULT_CANVAS_ID } from '../constants';
import type { CanvasInfo } from '../types';
import type { ConfirmOptions } from '../../../types';

export function CanvasSidebar({ navigate, confirm }: {
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}): ReactElement {
  const list = useCanvasList((a) => a.list);
  const loaded = useCanvasList((a) => a.loaded);
  const fetchList = useCanvasList((a) => a.fetchList);
  const remove = useCanvasList((a) => a.deleteCanvas);

  const confirmDelete = async (c: CanvasInfo) => {
    const ok = await confirm({
      title: 'Delete canvas',
      message: `Delete "${c.name}" and everything on it? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) void remove(c.id);
  };

  useEffect(() => { if (!loaded) fetchList(); }, [loaded, fetchList]);

  if (!loaded) {
    return <div style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>Loading…</div>;
  }
  if (list.length === 0) {
    return <div style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>No canvases yet.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {list.map((c) => (
        <CanvasRow key={c.id} canvas={c} navigate={navigate} onDelete={confirmDelete} />
      ))}
    </div>
  );
}

function CanvasRow({
  canvas, navigate, onDelete,
}: {
  canvas: CanvasInfo;
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  onDelete: (canvas: CanvasInfo) => Promise<void>;
}): ReactElement {
  const { onClick, onDoubleClick } = usePreviewClick(
    () => navigate(`/canvas/${canvas.id}`, { preview: true }),
    () => navigate(`/canvas/${canvas.id}`),
  );
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={canvas.name}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canvas.name}</span>
      {canvas.id !== DEFAULT_CANVAS_ID && (
        <button
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 4px', fontSize: 11, flexShrink: 0 }}
          title="Delete canvas"
          onClick={(e) => { e.stopPropagation(); void onDelete(canvas); }}
        >×</button>
      )}
    </div>
  );
}
