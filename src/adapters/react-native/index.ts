/**
 * React Native platform adapter
 * Implements platform-specific operations for React Native environment
 *
 * Note: This is a basic implementation. In production, you would need to:
 * 1. Install react-native-fs for file operations
 * 2. Install react-native-crypto or expo-crypto for crypto operations
 * 3. Properly configure these libraries in your React Native project
 */

import type { Cipheriv, Decipheriv } from 'crypto';
import { PassThrough, type Readable, type Writable } from 'stream';
import type {
  PlatformAdapter,
  FileSystem,
  FileStats,
  CryptoProvider
} from '../../interfaces/platform';

// These would be imported from actual React Native libraries
// import RNFS from 'react-native-fs';
// import { randomBytes as rnRandomBytes } from 'react-native-crypto';

type RNFSStat = {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
  mtime: number | string | Date;
  ctime: number | string | Date;
};

type RNFSEntry = {
  name: string;
};

type ReactNativeFSModule = {
  readFile(path: string, encoding: 'base64'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'base64'): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<RNFSStat>;
  readDir(path: string): Promise<RNFSEntry[]>;
  unlink(path: string): Promise<void>;
};

type ReactNativeCryptoModule = {
  randomBytes(size: number): Buffer | Uint8Array;
  createCipheriv(algorithm: string, key: Buffer, iv: Buffer): Cipheriv;
  createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): Decipheriv;
};

/**
 * React Native implementation of FileSystem interface.
 * The adapter delegates to the module provided via {@link configureReactNative},
 * mirroring the surface area exposed by `react-native-fs`.
 */
class ReactNativeFileSystem implements FileSystem {
  private rnfs: ReactNativeFSModule | null;

  constructor() {
    this.rnfs = null;
  }

  configure(module: ReactNativeFSModule): void {
    this.rnfs = module;
  }

  private ensureConfigured(): ReactNativeFSModule {
    if (this.rnfs === null) {
      throw new Error('React Native file system not configured. Call configureReactNative first.');
    }
    return this.rnfs;
  }

  createReadStream(filepath: string): Promise<Readable> {
    const rnfs = this.ensureConfigured();
    const stream = new PassThrough();

    void (async (): Promise<void> => {
      try {
        const base64 = await rnfs.readFile(filepath, 'base64');
        const buffer = Buffer.from(base64, 'base64');
        stream.end(buffer);
      } catch (error) {
        stream.emit('error', error);
      }
    })();

    return Promise.resolve(stream);
  }

  createWriteStream(filepath: string): Promise<Writable> {
    const rnfs = this.ensureConfigured();
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });

    stream.on('finish', () => {
      const data = Buffer.concat(chunks);
      void rnfs.writeFile(filepath, data.toString('base64'), 'base64').catch((error) => {
        stream.emit('error', error);
      });
    });

    return Promise.resolve(stream);
  }

  async readFile(filepath: string): Promise<Buffer> {
    const rnfs = this.ensureConfigured();
    const content = await rnfs.readFile(filepath, 'base64');
    return Buffer.from(content, 'base64');
  }

  async writeFile(filepath: string, data: Buffer): Promise<void> {
    const rnfs = this.ensureConfigured();
    await rnfs.writeFile(filepath, data.toString('base64'), 'base64');
  }

  async exists(filepath: string): Promise<boolean> {
    const rnfs = this.ensureConfigured();
    return rnfs.exists(filepath);
  }

  async stat(filepath: string): Promise<FileStats> {
    const rnfs = this.ensureConfigured();
    const stats = await rnfs.stat(filepath);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      modifiedTime: new Date(stats.mtime),
      createdTime: new Date(stats.ctime)
    };
  }

  async readdir(dirpath: string): Promise<string[]> {
    const rnfs = this.ensureConfigured();
    const items = await rnfs.readDir(dirpath);
    return items.map((item) => item.name);
  }

  async unlink(filepath: string): Promise<void> {
    const rnfs = this.ensureConfigured();
    await rnfs.unlink(filepath);
  }
}

/**
 * React Native implementation of CryptoProvider interface that wraps the
 * module supplied by {@link configureReactNative}. The module is expected to
 * expose Node-compatible `randomBytes`, `createCipheriv`, and `createDecipheriv`
 * methods (as provided by packages such as react-native-crypto).
 */
class ReactNativeCryptoProvider implements CryptoProvider {
  private cryptoLib: ReactNativeCryptoModule | null;

  constructor() {
    this.cryptoLib = null;
  }

  configure(module: ReactNativeCryptoModule): void {
    this.cryptoLib = module;
  }

  private ensureConfigured(): ReactNativeCryptoModule {
    if (this.cryptoLib === null) {
      throw new Error(
        'React Native crypto not configured. Install react-native-crypto or expo-crypto and call configureReactNative.'
      );
    }
    return this.cryptoLib;
  }

  randomBytes(size: number): Buffer {
    const cryptoLib = this.ensureConfigured();
    const result = cryptoLib.randomBytes(size);
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
  }

  createCipher(key: Buffer, iv: Buffer, encrypt: boolean): Cipheriv | Decipheriv {
    const cryptoLib = this.ensureConfigured();
    const algorithm = 'aes-256-ofb';
    return encrypt
      ? cryptoLib.createCipheriv(algorithm, key, iv)
      : cryptoLib.createDecipheriv(algorithm, key, iv);
  }
}

/**
 * React Native platform adapter
 */
export class ReactNativeAdapter implements PlatformAdapter {
  fs: ReactNativeFileSystem;
  crypto: ReactNativeCryptoProvider;
  name = 'react-native';

  constructor() {
    this.fs = new ReactNativeFileSystem();
    this.crypto = new ReactNativeCryptoProvider();
  }

  configure(rnfs: ReactNativeFSModule, cryptoModule: ReactNativeCryptoModule): void {
    this.fs.configure(rnfs);
    this.crypto.configure(cryptoModule);
  }

  isAvailable(): boolean {
    // Check if we're in React Native environment
    const globalObj = typeof global !== 'undefined' ? (global as Record<string, unknown>) : {};
    const hasDevFlag = '__DEV__' in globalObj;
    const navigator = globalObj.navigator as Record<string, unknown> | undefined;
    const isReactNative = navigator?.product === 'ReactNative';

    return hasDevFlag && isReactNative;
  }
}

/**
 * Default React Native adapter instance
 */
export const reactNativeAdapter = new ReactNativeAdapter();

/**
 * Inject the concrete React Native implementations for file system and
 * cryptography. Call this during app initialisation after installing
 * `react-native-fs` and either `react-native-crypto` or `expo-crypto` so the
 * adapter can operate outside of Node.js.
 *
 * @param rnfs The React Native FS module.
 * @param crypto The React Native crypto implementation.
 */
export function configureReactNative(
  rnfs: ReactNativeFSModule,
  crypto: ReactNativeCryptoModule
): void {
  reactNativeAdapter.configure(rnfs, crypto);
}
