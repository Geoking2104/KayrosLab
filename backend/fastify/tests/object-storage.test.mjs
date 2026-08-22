import test from 'node:test';
import assert from 'node:assert/strict';
import { DisabledObjectStorage, S3ObjectStorage, createObjectStorageFromEnv } from '../lib/object-storage.mjs';

class PutObjectCommand { constructor(input) { this.input = input; } }
class HeadObjectCommand { constructor(input) { this.input = input; } }

test('S3ObjectStorage signs the native SHA-256 checksum and verifies it on HEAD', async () => {
  const hex = 'ab'.repeat(32);
  const base64 = Buffer.from(hex, 'hex').toString('base64');
  let signedCommand;
  let headCommand;
  const storage = new S3ObjectStorage({
    bucket: 'private-corpus', PutObjectCommand, HeadObjectCommand,
    client: {
      async send(command) {
        headCommand = command;
        return { ContentLength: 42, ContentType: 'application/pdf', ChecksumSHA256: base64, ETag: 'etag' };
      },
    },
    async getSignedUrl(_client, command) { signedCommand = command; return 'https://objects.test/signed'; },
  });

  const upload = await storage.createUpload({ objectKey: 'tenant/case/document.pdf', contentType: 'application/pdf', sha256: hex });
  assert.equal(signedCommand.input.ChecksumSHA256, base64);
  assert.equal(upload.headers['x-amz-checksum-sha256'], base64);
  const head = await storage.headObject({ objectKey: 'tenant/case/document.pdf' });
  assert.equal(headCommand.input.ChecksumMode, 'ENABLED');
  assert.equal(head.sha256, hex);
  assert.equal(head.sizeBytes, 42);
});

test('object storage remains safely disabled when server credentials are absent', async () => {
  const storage = await createObjectStorageFromEnv({ KAYROS_S3_BUCKET: '' });
  assert.ok(storage instanceof DisabledObjectStorage);
  assert.equal(storage.configured, false);
  await assert.rejects(() => storage.createUpload(), (error) => error.code === 'OBJECT_STORAGE_UNAVAILABLE');
});
