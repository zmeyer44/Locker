import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import type { StorageProvider } from "./interface";
import { Readable } from "node:stream";

export interface S3StorageConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  bucket?: string;
  endpoint?: string;
}

export class S3StorageAdapter implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  readonly supportsPresignedUpload = true;

  constructor(config?: S3StorageConfig) {
    const region = config?.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.client = new S3Client({
      region,
      ...(config?.endpoint ? { endpoint: config.endpoint } : {}),
      credentials: {
        accessKeyId: config?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey:
          config?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    this.bucket = config?.bucket ?? process.env.S3_BUCKET ?? "locker";
  }

  async upload(params: {
    path: string;
    data: Buffer | ReadableStream;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; path: string }> {
    const body = Buffer.isBuffer(params.data)
      ? params.data
      : Readable.fromWeb(params.data as any);

    if (Buffer.isBuffer(body)) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.path,
          Body: body,
          ContentType: params.contentType,
          Metadata: params.metadata,
        }),
      );
    } else {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: params.path,
          Body: body,
          ContentType: params.contentType,
          Metadata: params.metadata,
        },
      });
      await upload.done();
    }

    return {
      url: `https://${this.bucket}.s3.${process.env.AWS_REGION ?? "us-east-1"}.amazonaws.com/${params.path}`,
      path: params.path,
    };
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
      contentType: response.ContentType ?? "application/octet-stream",
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

  async list(prefix: string): Promise<{
    path: string;
    size: number;
    lastModified: Date;
  }[]> {
    const results: { path: string; size: number; lastModified: Date }[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const item of response.Contents ?? []) {
        if (!item.Key) continue;
        results.push({
          path: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? new Date(0),
        });
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return results;
  }

  // ── Presigned upload (single PUT for small files) ─────────────────────

  async createPresignedUpload(params: {
    path: string;
    contentType: string;
    size: number;
    expiresIn?: number;
  }): Promise<{ url: string; method: "PUT" }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.path,
    });
    const url = await awsGetSignedUrl(this.client, command, {
      expiresIn: params.expiresIn ?? 3600,
    });
    return { url, method: "PUT" };
  }

  // ── Multipart upload (large files) ────────────────────────────────────

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
