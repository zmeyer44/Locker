import { MULTIPART_MAX_CONCURRENCY } from '@locker/common';

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

type TRPCMutate = {
  mutateAsync: (input: any) => Promise<any>;
};

export interface UploadFileOptions {
  file: File;
  folderId: string | null;
  workspaceSlug: string;
  conflictResolution?: "replace" | "keep-both";
  uploads: {
    initiate: TRPCMutate;
    complete: TRPCMutate;
    abort: TRPCMutate;
  };
  onProgress?: (progress: UploadProgress) => void;
  abortSignal?: AbortSignal;
}

export async function uploadFile(opts: UploadFileOptions): Promise<string> {
  const { file, folderId, workspaceSlug, conflictResolution, uploads, onProgress, abortSignal } =
    opts;

  // Step 1: Initiate upload
  const initResult = await uploads.initiate.mutateAsync({
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type || 'application/octet-stream',
    folderId,
    conflictResolution,
  });

  const { fileId, strategy } = initResult;

  try {
    if (strategy === 'server-buffered') {
      // Fallback: upload through the server, pass fileId to update existing record
      await uploadServerBuffered(file, folderId, workspaceSlug, fileId, onProgress, abortSignal);
      return fileId;
    }

    if (strategy === 'presigned-put') {
      // Single presigned PUT
      await uploadPresignedPut(
        file,
        initResult.presignedUrl,
        onProgress,
        abortSignal,
      );
      await uploads.complete.mutateAsync({ fileId });
      return fileId;
    }

    if (strategy === 'multipart') {
      // Multipart upload
      const parts = await uploadMultipart(
        file,
        initResult.parts,
        initResult.partSize,
        onProgress,
        abortSignal,
      );
      await uploads.complete.mutateAsync({
        fileId,
        uploadId: initResult.uploadId,
        parts,
      });
      return fileId;
    }

    throw new Error(`Unknown upload strategy: ${strategy}`);
  } catch (err) {
    // Abort on failure
    try {
      await uploads.abort.mutateAsync({
        fileId,
        uploadId: 'uploadId' in initResult ? initResult.uploadId : undefined,
      });
    } catch {
      // Best effort cleanup
    }
    throw err;
  }
}

// ── Server-buffered upload (local storage) ──────────────────────────────

async function uploadServerBuffered(
  file: File,
  folderId: string | null,
  workspaceSlug: string,
  fileId: string,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  // Use the streaming endpoint — sends the raw file body via PUT
  // instead of buffering into FormData. The server streams to disk.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percentage: Math.round((e.loaded / e.total) * 100),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error ?? 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort());
    }

    xhr.open('PUT', '/api/upload/stream');
    xhr.setRequestHeader('x-workspace-slug', workspaceSlug);
    xhr.setRequestHeader('x-file-id', fileId);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file); // Send raw file — no FormData wrapping
  });
}

// ── Single presigned PUT ────────────────────────────────────────────────

async function uploadPresignedPut(
  file: File,
  presignedUrl: string,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percentage: Math.round((e.loaded / e.total) * 100),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort());
    }

    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}

// ── Multipart upload ────────────────────────────────────────────────────

async function uploadMultipart(
  file: File,
  parts: { partNumber: number; url: string }[],
  partSize: number,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<{ partNumber: number; etag: string }[]> {
  const partLoaded = new Map<number, number>();

  const reportProgress = () => {
    if (!onProgress) return;
    let loaded = 0;
    partLoaded.forEach((v) => (loaded += v));
    onProgress({
      loaded,
      total: file.size,
      percentage: Math.round((loaded / file.size) * 100),
    });
  };

  const slices = parts.map((part) => {
    const start = (part.partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    return { ...part, blob: file.slice(start, end) };
  });

  // Upload with bounded concurrency
  const results: { partNumber: number; etag: string }[] = [];
  const executing = new Set<Promise<void>>();

  for (const part of slices) {
    if (abortSignal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }

    const task = uploadSinglePart(
      part,
      (loaded) => {
        partLoaded.set(part.partNumber, loaded);
        reportProgress();
      },
      abortSignal,
    )
      .then((result) => {
        results.push(result);
      })
      .finally(() => executing.delete(task));

    executing.add(task);

    if (executing.size >= MULTIPART_MAX_CONCURRENCY) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

async function uploadSinglePart(
  part: { partNumber: number; url: string; blob: Blob },
  onPartProgress: (loaded: number) => void,
  abortSignal?: AbortSignal,
  maxRetries = 3,
): Promise<{ partNumber: number; etag: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await doPartUpload(part, onPartProgress, abortSignal);
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error('unreachable');
}

function doPartUpload(
  part: { partNumber: number; url: string; blob: Blob },
  onProgress: (loaded: number) => void,
  abortSignal?: AbortSignal,
): Promise<{ partNumber: number; etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          return reject(
            new Error(`No ETag in response for part ${part.partNumber}`),
          );
        }
        resolve({
          partNumber: part.partNumber,
          etag: etag.replace(/"/g, ''),
        });
      } else {
        reject(
          new Error(`Part ${part.partNumber} upload failed: ${xhr.status}`),
        );
      }
    };

    xhr.onerror = () =>
      reject(new Error(`Network error on part ${part.partNumber}`));

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort());
    }

    xhr.open('PUT', part.url);
    xhr.send(part.blob);
  });
}
