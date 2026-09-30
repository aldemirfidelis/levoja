import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { AppConfig } from '../../config/config.module';

export interface StoredObject {
  stream: Readable;
  contentType?: string;
  size?: number;
}

interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
}

/**
 * Armazenamento de arquivos com duas visibilidades:
 * - `public/...`  : logos, fotos de produtos (podem ir para CDN).
 * - `private/...` : documentos pessoais — só são servidos pela API após checagem de permissão.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(private readonly config: AppConfig) {
    this.driver = config.env.STORAGE_DRIVER === 's3' ? new S3Driver(config) : new LocalDriver(config.env.STORAGE_LOCAL_PATH);
    this.logger.log(`Driver de armazenamento: ${config.env.STORAGE_DRIVER}`);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    assertSafeKey(key);
    await this.driver.put(key, body, contentType);
    return key;
  }

  get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    return this.driver.get(key);
  }

  async delete(key: string | null | undefined): Promise<void> {
    if (!key) return;
    assertSafeKey(key);
    await this.driver.delete(key).catch((error: Error) => this.logger.warn(`Falha ao remover ${key}: ${error.message}`));
  }

  /** URL pública para arquivos em `public/`. */
  publicUrl(key: string | null | undefined): string | null {
    if (!key) return null;
    const base = this.config.env.PUBLIC_FILES_BASE_URL;
    if (base) return `${base.replace(/\/$/, '')}/${key}`;
    return `${this.config.env.API_PUBLIC_URL.replace(/\/$/, '')}/v1/files/${key}`;
  }

  ping(): Promise<boolean> {
    return this.driver.ping();
  }
}

function assertSafeKey(key: string): void {
  if (!/^(public|private)\/[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) {
    throw new Error(`Chave de armazenamento inválida: ${key}`);
  }
}

class LocalDriver implements StorageDriver {
  private readonly root: string;

  constructor(path: string) {
    this.root = resolve(path);
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Caminho fora do diretório de armazenamento');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return { stream: createReadStream(path), size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async ping(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const env = config.env;
    this.bucket = env.S3_BUCKET!;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: key.startsWith('private/') ? 'AES256' : undefined,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { stream: result.Body as Readable, contentType: result.ContentType, size: result.ContentLength };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
