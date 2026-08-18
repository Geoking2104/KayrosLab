// S3-compatible object storage for direct, bounded Sales Oracle uploads.
// The browser sends bytes directly to S3/MinIO/OVH; Fastify only issues a
// short-lived signed URL and verifies object metadata before queuing ingestion.

export class DisabledObjectStorage {
  constructor() { this.configured = false; }
  async createUpload() { throw Object.assign(new Error('stockage objet non configuré'), { code: 'OBJECT_STORAGE_UNAVAILABLE', statusCode: 503 }); }
  async headObject() { throw Object.assign(new Error('stockage objet non configuré'), { code: 'OBJECT_STORAGE_UNAVAILABLE', statusCode: 503 }); }
}

export class S3ObjectStorage {
  constructor({ client, bucket, expiresIn = 900, getSignedUrl, PutObjectCommand, HeadObjectCommand } = {}) {
    if (!client || !bucket || !getSignedUrl || !PutObjectCommand || !HeadObjectCommand) throw new Error('S3ObjectStorage: configuration incomplète');
    this.client = client; this.bucket = bucket; this.expiresIn = expiresIn;
    this.getSignedUrl = getSignedUrl; this.PutObjectCommand = PutObjectCommand; this.HeadObjectCommand = HeadObjectCommand;
    this.configured = true;
  }

  async createUpload({ objectKey, contentType, sha256 }) {
    const checksumSha256 = Buffer.from(String(sha256), 'hex').toString('base64');
    const command = new this.PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, ContentType: contentType,
      ChecksumSHA256: checksumSha256, Metadata: { sha256: String(sha256) },
    });
    const url = await this.getSignedUrl(this.client, command, { expiresIn: this.expiresIn });
    return {
      method: 'PUT', url,
      headers: {
        'content-type': contentType,
        'x-amz-checksum-sha256': checksumSha256,
        'x-amz-meta-sha256': String(sha256),
      },
      expires_at: new Date(Date.now() + this.expiresIn * 1000).toISOString(),
    };
  }

  async headObject({ objectKey }) {
    const out = await this.client.send(new this.HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    return {
      sizeBytes: Number(out.ContentLength || 0), contentType: out.ContentType || null,
      sha256: out.ChecksumSHA256
        ? Buffer.from(out.ChecksumSHA256, 'base64').toString('hex')
        : null,
      etag: out.ETag || null,
    };
  }
}

export async function createObjectStorageFromEnv(env = process.env) {
  const bucket = env.KAYROS_S3_BUCKET || '';
  const accessKeyId = env.KAYROS_S3_ACCESS_KEY_ID || '';
  const secretAccessKey = env.KAYROS_S3_SECRET_ACCESS_KEY || '';
  if (!bucket || !accessKeyId || !secretAccessKey) return new DisabledObjectStorage();
  const [{ S3Client, PutObjectCommand, HeadObjectCommand }, { getSignedUrl }] = await Promise.all([
    import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner'),
  ]);
  const client = new S3Client({
    region: env.KAYROS_S3_REGION || 'us-east-1',
    endpoint: env.KAYROS_S3_ENDPOINT || undefined,
    forcePathStyle: /^(1|true)$/i.test(env.KAYROS_S3_FORCE_PATH_STYLE || ''),
    credentials: { accessKeyId, secretAccessKey },
  });
  return new S3ObjectStorage({
    client, bucket, getSignedUrl, PutObjectCommand, HeadObjectCommand,
    expiresIn: Math.min(3600, Math.max(60, Number(env.KAYROS_S3_UPLOAD_TTL_SECONDS) || 900)),
  });
}
