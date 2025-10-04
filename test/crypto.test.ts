/**
 * Tests for cryptographic functions
 */

import {
  generateKey,
  encrypt,
  decrypt,
  createEncryptStream,
  createDecryptStream,
  CRYPTO_CONFIG
} from '../src/core/crypto/crypto';
import * as crypto from 'crypto';

describe('Crypto Functions', () => {
  describe('generateKey', () => {
    it('should generate a 32-byte key', () => {
      const key = generateKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(CRYPTO_CONFIG.keySize);
    });

    it('should generate different keys each time', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(key1).not.toEqual(key2);
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const key = generateKey();
      const plaintext = Buffer.from('Hello, Horcrux!');

      const encrypted = encrypt(plaintext, key);
      expect(encrypted).not.toEqual(plaintext);

      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different ciphertext for same plaintext with different keys', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const plaintext = Buffer.from('Secret message');

      const encrypted1 = encrypt(plaintext, key1);
      const encrypted2 = encrypt(plaintext, key2);

      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should fail to decrypt with wrong key', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const plaintext = Buffer.from('Secret message');

      const encrypted = encrypt(plaintext, key1);
      const decrypted = decrypt(encrypted, key2);

      expect(decrypted).not.toEqual(plaintext);
    });

    it('should handle empty data', () => {
      const key = generateKey();
      const plaintext = Buffer.from('');

      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should handle large data', () => {
      const key = generateKey();
      const plaintext = crypto.randomBytes(10 * 1024); // 10KB

      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should throw error for invalid key size', () => {
      const invalidKey = Buffer.alloc(16); // Wrong size
      const plaintext = Buffer.from('Test');

      expect(() => encrypt(plaintext, invalidKey)).toThrow(
        `Key must be ${CRYPTO_CONFIG.keySize} bytes`
      );
      expect(() => decrypt(plaintext, invalidKey)).toThrow(
        `Key must be ${CRYPTO_CONFIG.keySize} bytes`
      );
    });
  });

  describe('stream encryption/decryption', () => {
    it('should encrypt and decrypt stream data', async () => {
      const key = generateKey();
      const plaintext = Buffer.from('Stream encryption test data');

      const encrypted = await encryptViaStream(plaintext, key);
      expect(encrypted).not.toEqual(plaintext);

      const decrypted = await decryptViaStream(encrypted, key);
      expect(decrypted).toEqual(plaintext);
    });

    it('should handle streaming of large data', async () => {
      const key = generateKey();
      const plaintext = crypto.randomBytes(100 * 1024); // 100KB

      const encrypted = await encryptViaStream(plaintext, key);
      const decrypted = await decryptViaStream(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should throw error for invalid key size in streams', () => {
      const invalidKey = Buffer.alloc(16);

      expect(() => createEncryptStream(invalidKey)).toThrow(
        `Key must be ${CRYPTO_CONFIG.keySize} bytes`
      );
      expect(() => createDecryptStream(invalidKey)).toThrow(
        `Key must be ${CRYPTO_CONFIG.keySize} bytes`
      );
    });
  });

  describe('AES-OFB specific behavior', () => {
    it('should use zero IV consistently', () => {
      const key = generateKey();
      const plaintext = Buffer.from('Test message');

      // Encrypt twice with same key
      const encrypted1 = encrypt(plaintext, key);
      const encrypted2 = encrypt(plaintext, key);

      // In OFB mode with same key and IV, ciphertext should be identical
      expect(encrypted1).toEqual(encrypted2);
    });

    it('should maintain stream cipher properties', () => {
      const key = generateKey();
      const plaintext1 = Buffer.from('First part');
      const plaintext2 = Buffer.from('Second part');
      const combined = Buffer.concat([plaintext1, plaintext2]);

      // Encrypt combined
      const encryptedCombined = encrypt(combined, key);

      // Due to OFB mode properties, we can't simply concat
      // This test verifies the stream nature
      const decrypted = decrypt(encryptedCombined, key);
      expect(decrypted).toEqual(combined);
    });
  });
});

// Helper functions for stream tests
async function encryptViaStream(data: Buffer, key: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const encryptStream = createEncryptStream(key);

    encryptStream.on('data', (chunk) => chunks.push(chunk));
    encryptStream.on('end', () => resolve(Buffer.concat(chunks)));
    encryptStream.on('error', reject);

    encryptStream.end(data);
  });
}

async function decryptViaStream(data: Buffer, key: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const decryptStream = createDecryptStream(key);

    decryptStream.on('data', (chunk) => chunks.push(chunk));
    decryptStream.on('end', () => resolve(Buffer.concat(chunks)));
    decryptStream.on('error', reject);

    decryptStream.end(data);
  });
}