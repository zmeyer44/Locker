import { put, del, head } from '@vercel/blob';
import type { StorageProvider } from './interface';

export class VercelBlobAdapter implements StorageProvider {
  readonly supportsPresignedUpload = false;

  async upload(params: {
    path: string;
    data: Buffer | ReadableStream;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; path: string }> {
    const blob = await put(params.path, params.data, {
      access: 'private',
      contentType: params.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return { url: blob.url, path: params.path };
  }

  async download(path: string): Promise<{
    data: ReadableStream;
    contentType: string;
    size: number;
  }> {
    const blobMeta = await head(path);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const response = await fetch(blobMeta.url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download blob (status ${response.status}): ${path}`);
    }

    return {
      data: response.body,
      contentType: blobMeta.contentType,
      size: blobMeta.size,
    };
  }

  async getSignedUrl(path: string, _expiresIn?: number): Promise<string> {
    const blobMeta = await head(path);
    return blobMeta.url;
  }

  async getUploadUrl(params: {
    path: string;
    contentType: string;
    expiresIn?: number;
  }): Promise<{ url: string }> {
    // Vercel Blob uses client uploads with tokens, not presigned URLs
    return { url: `/api/upload?path=${encodeURIComponent(params.path)}` };
  }

  async delete(path: string): Promise<void> {
    await del(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await head(path);
      return true;
    } catch {
      return false;
    }
  }
}
