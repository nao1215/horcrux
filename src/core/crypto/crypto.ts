/**
 * Cryptographic functions for Horcrux
 * Provides AES-256-OFB encryption/decryption functionality
 */

import * as crypto from 'crypto';
import type { Transform } from 'stream';

/**
 * Encryption configuration
 */
export const CRYPTO_CONFIG = {
  algorithm: 'aes-256-ofb' as const,
  keySize: 32, // 256 bits
  ivSize: 16 // 128 bits
};

/**
 * Generate a cryptographically secure 256-bit key suitable for AES-256-OFB,
 * using Node's CSPRNG. The key is consumed both for streaming and in-memory
 * encryption helpers during the split workflow.
 *
 * @returns 32-byte encryption key.
 */
export function generateKey(): Buffer {
  return crypto.randomBytes(CRYPTO_CONFIG.keySize);
}

/**
 * Create an AES-256-OFB cipher stream that mirrors the behaviour of the
 * original Horcrux implementation. An all-zero IV is required to stay
 * compatible with the reference Go toolchain.
 *
 * @param key The encryption key (32 bytes).
 * @returns Transform stream that encrypts data.
 */
export function createEncryptStream(key: Buffer): Transform {
  if (key.length !== CRYPTO_CONFIG.keySize) {
    throw new Error(`Key must be ${CRYPTO_CONFIG.keySize} bytes`);
  }

  // Use zero IV as specified in the original implementation
  const iv = Buffer.alloc(CRYPTO_CONFIG.ivSize, 0);
  const cipher = crypto.createCipheriv(CRYPTO_CONFIG.algorithm, key, iv);

  return cipher;
}

/**
 * Create the decrypting counterpart of {@link createEncryptStream}. The same
 * static IV is used so that shards produced in one runtime can be restored in
 * another.
 *
 * @param key The decryption key (32 bytes).
 * @returns Transform stream that decrypts data.
 */
export function createDecryptStream(key: Buffer): Transform {
  if (key.length !== CRYPTO_CONFIG.keySize) {
    throw new Error(`Key must be ${CRYPTO_CONFIG.keySize} bytes`);
  }

  // Use zero IV as specified in the original implementation
  const iv = Buffer.alloc(CRYPTO_CONFIG.ivSize, 0);
  const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.algorithm, key, iv);

  return decipher;
}

/**
 * Encrypt data in-memory using AES-256-OFB. This helper is primarily used by
 * the in-memory splitting logic and the replication pathway where the full
 * payload is available without streaming.
 *
 * @param data The data to encrypt.
 * @param key The encryption key.
 * @returns Encrypted data compatible with the streaming variant.
 */
export function encrypt(data: Buffer, key: Buffer): Buffer {
  if (key.length !== CRYPTO_CONFIG.keySize) {
    throw new Error(`Key must be ${CRYPTO_CONFIG.keySize} bytes`);
  }

  const iv = Buffer.alloc(CRYPTO_CONFIG.ivSize, 0);
  const cipher = crypto.createCipheriv(CRYPTO_CONFIG.algorithm, key, iv);

  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Decrypt data encrypted with {@link encrypt} or the streaming API.
 *
 * @param data The data to decrypt.
 * @param key The decryption key.
 * @returns Restored plaintext data.
 */
export function decrypt(data: Buffer, key: Buffer): Buffer {
  if (key.length !== CRYPTO_CONFIG.keySize) {
    throw new Error(`Key must be ${CRYPTO_CONFIG.keySize} bytes`);
  }

  const iv = Buffer.alloc(CRYPTO_CONFIG.ivSize, 0);
  const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.algorithm, key, iv);

  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Factory that returns either an encrypting or decrypting transform stream,
 * depending on `shouldEncrypt`. This helps adapters perform streaming
 * operations without branching on cipher creation logic.
 *
 * @param key The key for encryption/decryption.
 * @param shouldEncrypt Whether to encrypt (`true`) or decrypt (`false`).
 * @returns Transform stream suitable for piping binary data.
 */
export function createCryptoStream(key: Buffer, shouldEncrypt: boolean): Transform {
  return shouldEncrypt ? createEncryptStream(key) : createDecryptStream(key);
}
