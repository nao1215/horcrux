import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { splitFile, bindFiles, nodeAdapter } from '../src';

const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');
const horcruxSmallFixture = path.join(__dirname, 'fixtures', 'horcrux-small.png');
const outputDir = path.join(__dirname, 'temp-horcruxes');

let testImageExists = false;
let horcruxSmallExists = false;

// Declare these at top-level so they are accessible everywhere
let originalImageBuffer: Buffer;
let originalImageHash: string;

beforeAll(async () => {
  testImageExists = fs.existsSync(testImagePath);
  horcruxSmallExists = fs.existsSync(horcruxSmallFixture);

  if (testImageExists) {
    // Read original image and calculate hash
    originalImageBuffer = await fs.promises.readFile(testImagePath);
    originalImageHash = crypto.createHash('sha256').update(originalImageBuffer).digest('hex');

    // Create output directory
    await fs.promises.mkdir(outputDir, { recursive: true });
  }
});

afterAll(async () => {
  // Clean up output directory
  try {
    const files = await fs.promises.readdir(outputDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(outputDir, file));
    }
    await fs.promises.rmdir(outputDir);
  } catch (error) {
    // Ignore cleanup errors
  }
});

// --- Main test suite ---
describe('Image Split and Bind', () => {
  if (!testImageExists) {
    it('skipped: test-image.png does not exist in test/fixtures', () => {
      expect(true).toBe(true);
    });
    return;
  }

  // horcrux-small.png test path (assume it exists in fixtures)
  const horcruxSmallFixture = path.join(__dirname, 'fixtures', 'horcrux-small.png');

  describe('Successful restoration with sufficient horcruxes', () => {
    it('should split image into 5 horcruxes and restore with exactly threshold (3) horcruxes', async () => {
      // Split the image: 5 total, 3 threshold
      const splitResult = await splitFile(
        testImagePath,
        { total: 5, threshold: 3 },
        nodeAdapter
      );

      expect(splitResult.horcruxes).toHaveLength(5);
      expect(splitResult.originalSize).toBe(originalImageBuffer.length);

      // Save all horcruxes
      const horcruxPaths: string[] = [];
      for (let i = 0; i < splitResult.horcruxes.length; i++) {
        const horcrux = splitResult.horcruxes[i];
        const horcruxPath = path.join(outputDir, `image_${i + 1}_5.horcrux`);
        await fs.promises.writeFile(horcruxPath, horcrux.content);
        horcruxPaths.push(horcruxPath);
      }

      // Restore using exactly threshold (3) horcruxes
      const selectedPaths = [horcruxPaths[0], horcruxPaths[2], horcruxPaths[4]]; // Use 1st, 3rd, and 5th
      const restoredPath = path.join(outputDir, 'restored_threshold.png');

      const bindResult = await bindFiles(selectedPaths, restoredPath, nodeAdapter);

      expect(bindResult.filename).toBe('restored_threshold.png');
      expect(bindResult.horcruxesUsed).toBe(3);

      // Verify restored image matches original
      const restoredBuffer = await fs.promises.readFile(restoredPath);
      const restoredHash = crypto.createHash('sha256').update(restoredBuffer).digest('hex');

      expect(restoredHash).toBe(originalImageHash);
      expect(restoredBuffer.length).toBe(originalImageBuffer.length);
      expect(restoredBuffer.equals(originalImageBuffer)).toBe(true);
    });

    it('should restore with more than threshold horcruxes', async () => {
      // Split the image: 7 total, 4 threshold
      const splitResult = await splitFile(
        testImagePath,
        { total: 7, threshold: 4 },
        nodeAdapter
      );

      expect(splitResult.horcruxes).toHaveLength(7);

      // Save all horcruxes
      const horcruxPaths: string[] = [];
      for (let i = 0; i < splitResult.horcruxes.length; i++) {
        const horcrux = splitResult.horcruxes[i];
        const horcruxPath = path.join(outputDir, `image_extra_${i + 1}_7.horcrux`);
        await fs.promises.writeFile(horcruxPath, horcrux.content);
        horcruxPaths.push(horcruxPath);
      }

      // Restore using more than threshold (6 out of 7)
      const selectedPaths = horcruxPaths.slice(0, 6);
      const restoredPath = path.join(outputDir, 'restored_extra.png');

      const bindResult = await bindFiles(selectedPaths, restoredPath, nodeAdapter);

      expect(bindResult.filename).toBe('restored_extra.png');
      expect(bindResult.horcruxesUsed).toBe(4); // Should only use threshold amount

      // Verify restored image matches original
      const restoredBuffer = await fs.promises.readFile(restoredPath);
      const restoredHash = crypto.createHash('sha256').update(restoredBuffer).digest('hex');

      expect(restoredHash).toBe(originalImageHash);
      expect(restoredBuffer.equals(originalImageBuffer)).toBe(true);
    });
  });

  describe('Failed restoration with insufficient horcruxes', () => {
    it('should fail to restore with less than threshold horcruxes', async () => {
      // Split the image: 5 total, 3 threshold
      const splitResult = await splitFile(
        testImagePath,
        { total: 5, threshold: 3 },
        nodeAdapter
      );

      expect(splitResult.horcruxes).toHaveLength(5);

      // Save only 2 horcruxes (less than threshold of 3)
      const horcruxPaths: string[] = [];
      for (let i = 0; i < 2; i++) {
        const horcrux = splitResult.horcruxes[i];
        const horcruxPath = path.join(outputDir, `image_insufficient_${i + 1}_5.horcrux`);
        await fs.promises.writeFile(horcruxPath, horcrux.content);
        horcruxPaths.push(horcruxPath);
      }

      // Attempt to restore with insufficient horcruxes
      const restoredPath = path.join(outputDir, 'restored_insufficient.png');

      await expect(
        bindFiles(horcruxPaths, restoredPath, nodeAdapter)
      ).rejects.toThrow();
    });

    it('should fail to restore with only 1 horcrux when threshold is 2', async () => {
      // Split with minimum threshold
      const splitResult = await splitFile(
        testImagePath,
        { total: 3, threshold: 2 },
        nodeAdapter
      );

      expect(splitResult.horcruxes).toHaveLength(3);

      // Save only 1 horcrux
      const horcruxPath = path.join(outputDir, 'image_single.horcrux');
      await fs.promises.writeFile(horcruxPath, splitResult.horcruxes[0].content);

      // Attempt to restore with only 1 horcrux
      const restoredPath = path.join(outputDir, 'restored_single.png');

      await expect(
        bindFiles([horcruxPath], restoredPath, nodeAdapter)
      ).rejects.toThrow();
    });

    it('should fail when mixing horcruxes from different splits', async () => {
      // First split
      const split1 = await splitFile(
        testImagePath,
        { total: 3, threshold: 2 },
        nodeAdapter
      );

      // Second split (different parameters)
      const split2 = await splitFile(
        testImagePath,
        { total: 4, threshold: 3 },
        nodeAdapter
      );

      // Save one horcrux from each split
      const horcrux1Path = path.join(outputDir, 'mixed_1.horcrux');
      const horcrux2Path = path.join(outputDir, 'mixed_2.horcrux');

      await fs.promises.writeFile(horcrux1Path, split1.horcruxes[0].content);
      await fs.promises.writeFile(horcrux2Path, split2.horcruxes[1].content);

      // Attempt to restore with mixed horcruxes
      const restoredPath = path.join(outputDir, 'restored_mixed.png');

      await expect(
        bindFiles([horcrux1Path, horcrux2Path], restoredPath, nodeAdapter)
      ).rejects.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle all horcruxes required (threshold equals total)', async () => {
      // Split with threshold equal to total
      const splitResult = await splitFile(
        testImagePath,
        { total: 4, threshold: 4 },
        nodeAdapter
      );

      expect(splitResult.horcruxes).toHaveLength(4);

      // Save all horcruxes
      const horcruxPaths: string[] = [];
      for (let i = 0; i < splitResult.horcruxes.length; i++) {
        const horcrux = splitResult.horcruxes[i];
        const horcruxPath = path.join(outputDir, `image_all_${i + 1}_4.horcrux`);
        await fs.promises.writeFile(horcruxPath, horcrux.content);
        horcruxPaths.push(horcruxPath);
      }

      // Should succeed with all horcruxes
      const restoredPath = path.join(outputDir, 'restored_all.png');
      const bindResult = await bindFiles(horcruxPaths, restoredPath, nodeAdapter);

      expect(bindResult.horcruxesUsed).toBe(4);

      const restoredBuffer = await fs.promises.readFile(restoredPath);
      expect(restoredBuffer.equals(originalImageBuffer)).toBe(true);

      // Should fail with any horcrux missing
      const insufficientPaths = horcruxPaths.slice(0, 3);
      const failedPath = path.join(outputDir, 'restored_all_failed.png');

      await expect(
        bindFiles(insufficientPaths, failedPath, nodeAdapter)
      ).rejects.toThrow();
    });
  });

  describe('horcrux-small.png split and bind', () => {
    if (!horcruxSmallExists) {
      it('skipped: horcrux-small.png does not exist in test/fixtures', () => {
        expect(true).toBe(true);
      });
      return;
    }

    let smallImageBuffer: Buffer;
    let smallImageHash: string;

    beforeAll(async () => {
      smallImageBuffer = await fs.promises.readFile(horcruxSmallFixture);
      smallImageHash = crypto.createHash('sha256').update(smallImageBuffer).digest('hex');
    });

    it('should split horcrux-small.png into 4 horcruxes (threshold 3) and restore with threshold horcruxes', async () => {
      const splitResult = await splitFile(
        horcruxSmallFixture,
        { total: 4, threshold: 3 },
        nodeAdapter
      );
      expect(splitResult.horcruxes).toHaveLength(4);

      // Save horcruxes
      const horcruxPaths: string[] = [];
      for (let i = 0; i < splitResult.horcruxes.length; i++) {
        const horcruxPath = path.join(outputDir, `small_${i + 1}_4.horcrux`);
        await fs.promises.writeFile(horcruxPath, splitResult.horcruxes[i].content);
        horcruxPaths.push(horcruxPath);
      }

      // Restore with 3 horcruxes
      const selected = horcruxPaths.slice(0, 3);
      const restoredPath = path.join(outputDir, 'restored_small_threshold.png');
      const bindResult = await bindFiles(selected, restoredPath, nodeAdapter);

      expect(bindResult.filename).toBe('restored_small_threshold.png');
      expect(bindResult.horcruxesUsed).toBe(3);

      const restoredBuffer = await fs.promises.readFile(restoredPath);
      const restoredHash = crypto.createHash('sha256').update(restoredBuffer).digest('hex');
      expect(restoredHash).toBe(smallImageHash);
      expect(restoredBuffer.equals(smallImageBuffer)).toBe(true);
    });

    it('should fail to restore horcrux-small.png with less than threshold horcruxes', async () => {
      const splitResult = await splitFile(
        horcruxSmallFixture,
        { total: 4, threshold: 3 },
        nodeAdapter
      );
      expect(splitResult.horcruxes).toHaveLength(4);

      // Save only 2 horcruxes
      const horcruxPaths: string[] = [];
      for (let i = 0; i < 2; i++) {
        const horcruxPath = path.join(outputDir, `small_insufficient_${i + 1}_4.horcrux`);
        await fs.promises.writeFile(horcruxPath, splitResult.horcruxes[i].content);
        horcruxPaths.push(horcruxPath);
      }

      // Restore with 2 horcruxes should fail
      const restoredPath = path.join(outputDir, 'restored_small_insufficient.png');
      await expect(
        bindFiles(horcruxPaths, restoredPath, nodeAdapter)
      ).rejects.toThrow();
    });
  });
});
