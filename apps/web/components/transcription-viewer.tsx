"use client";

import { RefreshCw, Trash2, FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function TranscriptionViewer({
  open,
  onOpenChange,
  file,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: { id: string; name: string };
}) {
  const utils = trpc.useUtils();

  const { data: transcription, isLoading } =
    trpc.transcriptions.getByFileId.useQuery(
      { fileId: file.id },
      { enabled: open },
    );

  const generate = trpc.transcriptions.generate.useMutation({
    onSuccess: (result) => {
      if (result.status === "queued") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      utils.transcriptions.getByFileId.invalidate({ fileId: file.id });
      utils.transcriptions.statusByFileIds.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = trpc.transcriptions.delete.useMutation({
    onSuccess: () => {
      toast.success("Transcription deleted");
      utils.transcriptions.getByFileId.invalidate({ fileId: file.id });
      utils.transcriptions.statusByFileIds.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Transcription
          </DialogTitle>
          <DialogDescription className="truncate">
            {file.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !transcription ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                No transcription available for this file.
              </p>
              <Button
                size="sm"
                onClick={() => generate.mutate({ fileId: file.id })}
                disabled={generate.isPending}
              >
                {generate.isPending && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Generate Transcription
              </Button>
            </div>
          ) : transcription.status === "processing" ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Transcription in progress...</span>
            </div>
          ) : transcription.status === "failed" ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-destructive mb-2">
                Transcription failed
              </p>
              {transcription.errorMessage && (
                <p className="text-xs text-muted-foreground mb-4 max-w-md">
                  {transcription.errorMessage}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => generate.mutate({ fileId: file.id })}
                disabled={generate.isPending}
              >
                {generate.isPending && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Retry
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono">
                {transcription.content}
              </pre>
            </div>
          )}
        </div>

        {transcription && transcription.status === "ready" && (
          <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => remove.mutate({ fileId: file.id })}
              disabled={remove.isPending}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generate.mutate({ fileId: file.id })}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Regenerate
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
