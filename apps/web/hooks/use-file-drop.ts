import { trpc } from '@/lib/trpc/client';
import { toast } from 'sonner';

export function useFileDrop() {
  const utils = trpc.useUtils();

  const moveFile = trpc.files.move.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate();
      utils.folders.list.invalidate();
      toast.success('File moved');
    },
    onError: (err) => {
      toast.error(`Failed to move: ${err.message}`);
    },
  });

  const moveFolder = trpc.folders.move.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      utils.files.list.invalidate();
      toast.success('Folder moved');
    },
    onError: (err) => {
      toast.error(`Failed to move: ${err.message}`);
    },
  });

  const handleDrop = (
    draggedItem: { id: string; type: 'file' | 'folder' },
    targetFolderId: string,
  ) => {
    if (draggedItem.type === 'folder' && draggedItem.id === targetFolderId) {
      return;
    }

    if (draggedItem.type === 'file') {
      moveFile.mutate({ id: draggedItem.id, targetFolderId });
    } else {
      moveFolder.mutate({ id: draggedItem.id, targetFolderId });
    }
  };

  return { handleDrop, isMoving: moveFile.isPending || moveFolder.isPending };
}
