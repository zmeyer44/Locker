import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './interface';

export class R2StorageAdapter implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string | undefined;

  readonly supportsPresignedUpload = true;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID!;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = process.env.R2_BUCKET ?? 'openstore';
    this.publicUrl = process.env.R2_PUBLIC_URL;
  }

  async upload(params: {
    path: string;
    data: Buffer | ReadableStream;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; path: string }> {
    let body: Buffer;
    if (Buffer.isBuffer(params.data)) {
      body = params.data;
    } else {
      const reader = (params.data as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
      }
      body = Buffer.concat(chunks);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
        Body: body,
        ContentType: params.contentType,
        Metadata: params.metadata,
      }),
    );

    const url = this.publicUrl
      ? `${this.publicUrl}/${params.path}`
      : params.path;

    return { url, path: params.path };
  }

  async download(path: string): Promise<{
    data: ReadableStream;
    contentType: string;
    size: number;
  }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: path,
      }),
    );

    return {
      data: response.Body!.transformToWebStream(),
      contentType: response.ContentType ?? 'application/octet-stream',
      size: response.ContentLength ?? 0,
    };
  }

  async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
    });
    return awsGetSignedUrl(this.client, command, { expiresIn });
  }

  async getUploadUrl(params: {
    path: string;
    contentType: string;
    expiresIn?: number;
  }): Promise<{ url: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.path,
      ContentType: params.contentType,
    });
    const url = await awsGetSignedUrl(this.client, command, {
      expiresIn: params.expiresIn ?? 3600,
    });
    return { url };
  }

  async delete(path: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: path,
      }),
    );
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: path,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async createPresignedUpload(params: {
    path: string;
    contentType: string;
    size: number;
    expiresIn?: number;
  }): Promise<{ url: string; method: 'PUT' }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.path,
      ContentType: params.contentType,
      ContentLength: params.size,
    });
    const url = await awsGetSignedUrl(this.client, command, {
      expiresIn: params.expiresIn ?? 3600,
    });
    return { url, method: 'PUT' };
  }

  async createMultipartUpload(params: {
    path: string;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.path,
        ContentType: params.contentType,
      }),
    );
    return { uploadId: result.UploadId! };
  }

  async getMultipartPartUrls(params: {
    path: string;
    uploadId: string;
    parts: number;
    expiresIn?: number;
  }): Promise<{ urls: { partNumber: number; url: string }[] }> {
    const urls = await Promise.all(
      Array.from({ length: params.parts }, (_, i) => i + 1).map(
        async (partNumber) => {
          const command = new UploadPartCommand({
            Bucket: this.bucket,
            Key: params.path,
            UploadId: params.uploadId,
            PartNumber: partNumber,
          });
          const url = await awsGetSignedUrl(this.client, command, {
            expiresIn: params.expiresIn ?? 3600,
          });
          return { partNumber, url };
        },
      ),
    );
    return { urls };
  }

  async completeMultipartUpload(params: {
    path: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.path,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: params.parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(params: {
    path: string;
    uploadId: string;
  }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.path,
        UploadId: params.uploadId,
      }),
    );
  }
}
