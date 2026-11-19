import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { splitFile, bindFiles, nodeAdapter } from '../src';
import { saveHorcruxes } from '../src/core/split';

// A 342 KiB PNG: large enough that every shard of the distributed layout holds
// many kilobytes of cipher text.
const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');
const originalImage = fs.readFileSync(testImagePath);

let outputDir: string;

beforeEach(async () => {
  outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'horcrux-image-'));
});

afterEach(async () => {
  await fs.promises.rm(outputDir, { recursive: true, force: true });
});

async function splitAndSave(total: number, threshold: number): Promise<string[]> {
  const result = await splitFile(testImagePath, { total, threshold }, nodeAdapter);
  expect(result.horcruxes).toHaveLength(total);
  expect(result.originalSize).toBe(originalImage.length);
  return saveHorcruxes(result.horcruxes, outputDir, nodeAdapter);
}

describe('Image split and bind', () => {
  it('restores the image from exactly threshold (3 of 5) horcruxes', async () => {
    const paths = await splitAndSave(5, 3);
    const restoredPath = path.join(outputDir, 'restored.png');

    const result = await bindFiles([paths[0], paths[2], paths[4]], restoredPath, nodeAdapter);

    expect(result.filename).toBe('test-image.png');
    expect(result.horcruxesUsed).toBe(3);
    expect((await fs.promises.readFile(restoredPath)).equals(originalImage)).toBe(true);
  });

  it('uses only threshold horcruxes when more are given (6 of 7, threshold 4)', async () => {
    const paths = await splitAndSave(7, 4);
    const restoredPath = path.join(outputDir, 'restored.png');

    const result = await bindFiles(paths.slice(0, 6), restoredPath, nodeAdapter);

    expect(result.horcruxesUsed).toBe(4);
    expect((await fs.promises.readFile(restoredPath)).equals(originalImage)).toBe(true);
  });

  it('restores the image when every horcrux is required (4 of 4)', async () => {
    const paths = await splitAndSave(4, 4);
    const restoredPath = path.join(outputDir, 'restored.png');

    const result = await bindFiles(paths, restoredPath, nodeAdapter);

    expect(result.horcruxesUsed).toBe(4);
    expect((await fs.promises.readFile(restoredPath)).equals(originalImage)).toBe(true);
  });

  it('rejects fewer horcruxes than the threshold', async () => {
    const paths = await splitAndSave(5, 3);

    await expect(
      bindFiles(paths.slice(0, 2), path.join(outputDir, 'restored.png'), nodeAdapter)
    ).rejects.toThrow('Not enough horcruxes: have 2, need 3');
  });

  it('rejects one missing horcrux when every horcrux is required', async () => {
    const paths = await splitAndSave(4, 4);

    await expect(
      bindFiles(paths.slice(0, 3), path.join(outputDir, 'restored.png'), nodeAdapter)
    ).rejects.toThrow('Not enough horcruxes: have 3, need 4');
  });
});
