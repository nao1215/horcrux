import * as crypto from 'crypto';
import { configureReactNative, reactNativeAdapter } from '../src/adapters/react-native';
import { splitBuffer, saveHorcruxes } from '../src/core/split';
import { autoBind } from '../src/core/bind';

type MemoryFile = {
  data: Buffer;
  created: Date;
  modified: Date;
};

class MemoryRNFS {
  private files = new Map<string, MemoryFile>();

  reset(): void {
    this.files.clear();
  }

  async readFile(path: string, encoding: 'base64'): Promise<string> {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return file.data.toString(encoding);
  }

  async writeFile(path: string, data: string, encoding: 'base64'): Promise<void> {
    const buffer = Buffer.from(data, encoding);
    const existing = this.files.get(path);
    const now = new Date();
    this.files.set(path, {
      data: buffer,
      created: existing?.created ?? now,
      modified: now
    });
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string) {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return {
      size: file.data.length,
      isFile: () => true,
      isDirectory: () => false,
      mtime: file.modified,
      ctime: file.created
    };
  }

  async readDir(dirpath: string) {
    const prefix = dirpath.endsWith('/') ? dirpath : `${dirpath}/`;
    const names = new Set<string>();

    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const name = path.slice(prefix.length).split('/')[0];
        if (name !== '') {
          names.add(name);
        }
      }
    }

    return Array.from(names).map((name) => ({ name }));
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }
}

const memoryRNFS = new MemoryRNFS();

describe('React Native adapter integration', () => {
  beforeEach(() => {
    memoryRNFS.reset();
    configureReactNative(memoryRNFS, crypto);
  });

  it('writes and reads files using configured RNFS module', async () => {
    const adapter = reactNativeAdapter;
    const filepath = 'app/data/sample.bin';
    const payload = Buffer.from('rn-test');

    await adapter.fs.writeFile(filepath, payload);

    expect(await adapter.fs.exists(filepath)).toBe(true);

    const readBack = await adapter.fs.readFile(filepath);
    expect(readBack.equals(payload)).toBe(true);

    const stats = await adapter.fs.stat(filepath);
    expect(stats.size).toBe(payload.length);

    const entries = await adapter.fs.readdir('app/data');
    expect(entries).toContain('sample.bin');
  });

  it('saves and binds horcruxes using the React Native adapter', async () => {
    const adapter = reactNativeAdapter;
    const data = Buffer.from('react-native secret');
    const splitResult = await splitBuffer(data, 'secret.txt', {
      total: 3,
      threshold: 2
    });

    const outputDir = 'rn-output';
    const savedFiles = await saveHorcruxes(splitResult.horcruxes, outputDir, adapter);

    expect(savedFiles).toHaveLength(3);

    const bindResult = await autoBind(outputDir, adapter);
    expect(bindResult.data.equals(data)).toBe(true);
    expect(bindResult.horcruxesUsed).toBe(2);
  });
});
