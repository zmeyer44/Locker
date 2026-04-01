export interface StorageProvider {
  upload(params: {
    path: string;
    data: Buffer | ReadableStream;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; path: string }>;

  download(path: string): Promise<{
    data: ReadableStream;
    contentType: string;
    size: number;
  }>;

  getSignedUrl(path: string, expiresIn?: number): Promise<string>;

  getUploadUrl(params: {
    path: string;
    contentType: string;
    expiresIn?: number;
  }): Promise<{ url: string; fields?: Record<string, string> }>;

  delete(path: string): Promise<void>;

  exists(path: string): Promise<boolean>;

  // Presigned upload support
  readonly supportsPresignedUpload: boolean;

  createPresignedUpload?(params: {
    path: string;
    contentType: string;
    size: number;
    expiresIn?: number;
  }): Promise<{ url: string; method: 'PUT' }>;

  createMultipartUpload?(params: {
    path: string;
    contentType: string;
  }): Promise<{ uploadId: string }>;

  getMultipartPartUrls?(params: {
    path: string;
    uploadId: string;
    parts: number;
    expiresIn?: number;
  }): Promise<{ urls: { partNumber: number; url: string }[] }>;

  completeMultipartUpload?(params: {
    path: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<void>;

  abortMultipartUpload?(params: {
    path: string;
    uploadId: string;
  }): Promise<void>;
}
