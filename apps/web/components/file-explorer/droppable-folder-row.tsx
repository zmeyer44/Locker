'use client';

import { useRef, useEffect, useState, type ReactNode } from 'react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { cn } from '@/lib/utils';

interface DroppableFolderRowProps {
  folderId: string;
  folderName: string;
  onDrop: (
    item: { id: string; type: 'file' | 'folder' },
    targetFolderId: string,
  ) => void;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

export function DroppableFolderRow({
  folderId,
  folderName,
  onDrop,
  onClick,
  className,
  children,
}: DroppableFolderRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'dragging' | 'over'>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const cleanupDrag = draggable({
      element: el,
      getInitialData: () => ({
        id: folderId,
        type: 'folder' as const,
        name: folderName,
      }),
      onDragStart: () => setState('dragging'),
      onDrop: () => setState('idle'),
    });

    const cleanupDrop = dropTargetForElements({
      element: el,
      getData: () => ({ targetFolderId: folderId }),
      canDrop: ({ source }) => {
        // Don't allow dropping a folder onto itself
        if (source.data.type === 'folder' && source.data.id === folderId) {
          return false;
        }
        return true;
      },
      onDragEnter: () => setState((s) => (s === 'dragging' ? s : 'over')),
      onDragLeave: () => setState((s) => (s === 'dragging' ? s : 'idle')),
      onDrop: ({ source }) => {
        setState('idle');
        onDrop(
          {
            id: source.data.id as string,
            type: source.data.type as 'file' | 'folder',
          },
          folderId,
        );
      },
    });

    return () => {
      cleanupDrag();
      cleanupDrop();
    };
  }, [folderId, folderName, onDrop]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        className,
        state === 'dragging' && 'opacity-40',
        state === 'over' && 'ring-2 ring-primary ring-inset bg-primary/5',
      )}
    >
      {children}
    </div>
  );
}
