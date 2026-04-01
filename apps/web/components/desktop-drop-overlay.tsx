'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DesktopDropOverlayProps {
  onFilesDropped: (files: File[]) => void;
}

export function DesktopDropOverlay({ onFilesDropped }: DesktopDropOverlayProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    // Only respond to external file drags, not internal element drags
    if (!e.dataTransfer?.types.includes('Files')) return;

    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
      if (droppedFiles.length > 0) {
        onFilesDropped(droppedFiles);
      }
    },
    [onFilesDropped],
  );

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isDragOver) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/20 backdrop-blur-sm">
      <div className="pointer-events-none flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-primary/5 p-16">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Upload className="size-8 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold">Drop files to upload</p>
          <p className="text-sm text-muted-foreground">
            Release to add files to the current folder
          </p>
        </div>
      </div>
    </div>
  );
}
