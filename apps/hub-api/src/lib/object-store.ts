import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type ObjectStore = {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
};

function assertObjectKey(key: string) {
  const parts = key.split("/");
  if (!key || key.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe object key: ${key}`);
  }
}

class FsObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer) {
    assertObjectKey(key);
    const dest = join(this.root, key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }

  async get(key: string) {
    assertObjectKey(key);
    return readFile(join(this.root, key));
  }
}

class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: { endpoint: string; region: string; accessKey: string; secretKey: string },
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  async put(key: string, body: Buffer) {
    assertObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
      }),
    );
  }

  async get(key: string) {
    assertObjectKey(key);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`empty object: ${key}`);
    return Buffer.from(bytes);
  }
}

export function createObjectStore(options: {
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  region: string;
  root: string;
}): ObjectStore {
  if (options.endpoint && options.accessKey && options.secretKey) {
    return new S3ObjectStore(options.bucket, {
      endpoint: options.endpoint,
      region: options.region,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
  }
  return new FsObjectStore(options.root);
}
