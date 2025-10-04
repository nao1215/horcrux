/**
 * Platform-specific interfaces
 * Abstractions for file system and crypto operations
 */

import type { Readable, Writable } from 'stream';

/**
 * File system operations interface
 * Implementations vary between Node.js and React Native
 */
export interface FileSystem {
  /**
   * Read a file as a stream
   * @param path File path
   * @returns Readable stream
   */
  createReadStream(path: string): Promise<Readable>;

  /**
   * Write to a file as a stream
   * @param path File path
   * @returns Writable stream
   */
  createWriteStream(path: string): Promise<Writable>;

  /**
   * Read entire file into memory
   * @param path File path
   * @returns File contents as Buffer
   */
  readFile(path: string): Promise<Buffer>;

  /**
   * Write entire buffer to file
   * @param path File path
   * @param data Data to write
   */
  writeFile(path: string, data: Buffer): Promise<void>;

  /**
   * Check if file exists
   * @param path File path
   * @returns True if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get file metadata
   * @param path File path
   * @returns File stats
   */
  stat(path: string): Promise<FileStats>;

  /**
   * List files in directory
   * @param path Directory path
   * @returns Array of filenames
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Delete a file
   * @param path File path
   */
  unlink(path: string): Promise<void>;
}

/**
 * File statistics
 */
export interface FileStats {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  modifiedTime: Date;
  createdTime: Date;
}

/**
 * Crypto provider interface
 * Allows for platform-specific crypto implementations
 */
export interface CryptoProvider {
  /**
   * Generate random bytes
   * @param size Number of bytes to generate
   * @returns Random bytes
   */
  randomBytes(size: number): Buffer;

  /**
   * Create AES-256-OFB cipher
   * @param key Encryption key
   * @param iv Initialization vector
   * @param encrypt True for encryption, false for decryption
   * @returns Transform stream
   */
  createCipher(key: Buffer, iv: Buffer, encrypt: boolean): unknown;
}

/**
 * Platform adapter combining all platform-specific operations
 */
export interface PlatformAdapter {
  fs: FileSystem;
  crypto: CryptoProvider;

  /**
   * Get platform name
   */
  name: string;

  /**
   * Check if platform is available
   */
  isAvailable(): boolean;
}
