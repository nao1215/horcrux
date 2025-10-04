/**
 * Node.js platform adapter
 * Implements platform-specific operations for Node.js environment
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Readable, Writable } from 'stream';
import type {
  PlatformAdapter,
  FileSystem,
  FileStats,
  CryptoProvider
} from '../../interfaces/platform';

const fsPromises = fs.promises;

/**
 * Node.js implementation of FileSystem interface
 */
class NodeFileSystem implements FileSystem {
  createReadStream(filepath: string): Promise<Readable> {
    return Promise.resolve(fs.createReadStream(filepath));
  }

  async createWriteStream(filepath: string): Promise<Writable> {
    // Ensure directory exists
    const dir = path.dirname(filepath);
    await fsPromises.mkdir(dir, { recursive: true });
    return fs.createWriteStream(filepath);
  }

  async readFile(filepath: string): Promise<Buffer> {
    return fsPromises.readFile(filepath);
  }

  async writeFile(filepath: string, data: Buffer): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filepath);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(filepath, data);
  }

  async exists(filepath: string): Promise<boolean> {
    try {
      await fsPromises.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(filepath: string): Promise<FileStats> {
    const stats = await fsPromises.stat(filepath);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      modifiedTime: stats.mtime,
      createdTime: stats.birthtime
    };
  }

  async readdir(dirpath: string): Promise<string[]> {
    return fsPromises.readdir(dirpath);
  }

  async unlink(filepath: string): Promise<void> {
    await fsPromises.unlink(filepath);
  }
}

/**
 * Node.js implementation of CryptoProvider interface
 */
class NodeCryptoProvider implements CryptoProvider {
  randomBytes(size: number): Buffer {
    return crypto.randomBytes(size);
  }

  createCipher(key: Buffer, iv: Buffer, encrypt: boolean): crypto.Cipheriv | crypto.Decipheriv {
    const algorithm = 'aes-256-ofb';
    if (encrypt) {
      return crypto.createCipheriv(algorithm, key, iv);
    }
    return crypto.createDecipheriv(algorithm, key, iv);
  }
}

/**
 * Node.js platform adapter
 */
export class NodeAdapter implements PlatformAdapter {
  fs: FileSystem;
  crypto: CryptoProvider;
  name = 'node';

  constructor() {
    this.fs = new NodeFileSystem();
    this.crypto = new NodeCryptoProvider();
  }

  isAvailable(): boolean {
    // Check if we're in Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return typeof process !== 'undefined' && process?.versions?.node !== undefined;
  }
}

/**
 * Default Node.js adapter instance
 */
export const nodeAdapter = new NodeAdapter();
