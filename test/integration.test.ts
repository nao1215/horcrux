/**
 * Integration tests for the complete Horcrux workflow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { promisify } from 'util';

import {
  splitFile,
  splitBuffer,
  saveHorcruxes
} from '../src/core/split';

import {
  bindHorcruxes,
  bindFiles,
  autoBind,
  loadHorcrux,
  findHorcruxes
} from '../src/core/bind';

import { nodeAdapter } from '../src/adapters/node';

const mkdtemp = promisify(fs.mkdtemp);
const rmdir = promisify(fs.rmdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

describe('Horcrux Integration Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'horcrux-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      const files = await fs.promises.readdir(tempDir);
      for (const file of files) {
        await unlink(path.join(tempDir, file));
      }
      await rmdir(tempDir);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Buffer operations', () => {
    it('should split and bind buffer with 3-of-5 threshold', async () => {
      const originalData = Buffer.from('This is a test message for Horcrux splitting!');
      const filename = 'test.txt';

      // Split the buffer
      const splitResult = await splitBuffer(originalData, filename, {
        total: 5,
        threshold: 3
      });

      expect(splitResult.horcruxes).toHaveLength(5);
      expect(splitResult.originalSize).toBe(originalData.length);

      // Bind using minimum threshold
      const bindResult = await bindHorcruxes(splitResult.horcruxes.slice(0, 3));

      expect(bindResult.data).toEqual(originalData);
      expect(bindResult.filename).toBe(filename);
      expect(bindResult.horcruxesUsed).toBe(3);
    });

    it('should split and bind with 5-of-5 threshold (space-efficient mode)', async () => {
      const originalData = crypto.randomBytes(1000);
      const filename = 'random.bin';

      // Split with threshold === total
      const splitResult = await splitBuffer(originalData, filename, {
        total: 5,
        threshold: 5
      });

      // In space-efficient mode, each horcrux should be roughly 1/5 of encrypted size
      const avgSize = splitResult.totalSize / 5;
      splitResult.horcruxes.forEach(h => {
        expect(Math.abs(h.content.length - avgSize)).toBeLessThan(100);
      });

      // Bind all horcruxes
      const bindResult = await bindHorcruxes(splitResult.horcruxes);
      expect(bindResult.data).toEqual(originalData);
    });

    it('should fail binding with insufficient horcruxes', async () => {
      const originalData = Buffer.from('Secret data');
      const filename = 'secret.txt';

      const splitResult = await splitBuffer(originalData, filename, {
        total: 5,
        threshold: 3
      });

      // Try to bind with only 2 horcruxes (need 3)
      await expect(
        bindHorcruxes(splitResult.horcruxes.slice(0, 2))
      ).rejects.toThrow('Not enough horcruxes: have 2, need 3');
    });
  });

  describe('File operations', () => {
    it('should split and bind a file', async () => {
      // Create test file
      const testFile = path.join(tempDir, 'original.txt');
      const testData = Buffer.from('File content for splitting into horcruxes');
      await writeFile(testFile, testData);

      // Split the file
      const splitResult = await splitFile(testFile, {
        total: 4,
        threshold: 2
      }, nodeAdapter);

      expect(splitResult.horcruxes).toHaveLength(4);

      // Save horcruxes to files
      const savedPaths = await saveHorcruxes(
        splitResult.horcruxes,
        tempDir,
        nodeAdapter
      );

      expect(savedPaths).toHaveLength(4);

      // Load and bind horcruxes
      const horcrux1 = await loadHorcrux(savedPaths[0], nodeAdapter);
      const horcrux2 = await loadHorcrux(savedPaths[1], nodeAdapter);

      const bindResult = await bindHorcruxes([horcrux1, horcrux2]);
      expect(bindResult.data).toEqual(testData);
    });

    it('should handle large files', async () => {
      // Create large test file (1MB)
      const testFile = path.join(tempDir, 'large.bin');
      const testData = crypto.randomBytes(1024 * 1024);
      await writeFile(testFile, testData);

      // Split the file
      const splitResult = await splitFile(testFile, {
        total: 3,
        threshold: 2
      }, nodeAdapter);

      // Save and reload horcruxes
      const savedPaths = await saveHorcruxes(
        splitResult.horcruxes,
        tempDir,
        nodeAdapter
      );

      const outputFile = path.join(tempDir, 'restored.bin');
      await bindFiles(
        savedPaths.slice(0, 2),
        outputFile,
        nodeAdapter
      );

      // Verify restored file
      const restoredData = await readFile(outputFile);
      expect(restoredData).toEqual(testData);
    });
  });

  describe('Auto-bind functionality', () => {
    it('should auto-detect and bind horcruxes from directory', async () => {
      const originalData = Buffer.from('Auto-bind test data');
      const filename = 'autotest.txt';

      // Create and save horcruxes
      const splitResult = await splitBuffer(originalData, filename, {
        total: 3,
        threshold: 2
      });

      await saveHorcruxes(splitResult.horcruxes, tempDir, nodeAdapter);

      // Auto-bind from directory
      const bindResult = await autoBind(tempDir, nodeAdapter);

      expect(bindResult.data).toEqual(originalData);
      expect(bindResult.filename).toBe(filename);
    });

    it('should find all horcrux files in directory', async () => {
      // Create multiple sets of horcruxes
      const data1 = Buffer.from('First file');
      const data2 = Buffer.from('Second file');

      const split1 = await splitBuffer(data1, 'file1.txt', {
        total: 2,
        threshold: 2
      });

      const split2 = await splitBuffer(data2, 'file2.txt', {
        total: 2,
        threshold: 2
      });

      await saveHorcruxes(split1.horcruxes, tempDir, nodeAdapter);
      await saveHorcruxes(split2.horcruxes, tempDir, nodeAdapter);

      // Find all horcruxes
      const found = await findHorcruxes(tempDir, nodeAdapter);

      expect(found).toHaveLength(4); // 2 + 2
    });

    it('should error when multiple file sets exist', async () => {
      // Create horcruxes from different files
      const split1 = await splitBuffer(Buffer.from('File 1'), 'file1.txt', {
        total: 2,
        threshold: 2
      });

      const split2 = await splitBuffer(Buffer.from('File 2'), 'file2.txt', {
        total: 2,
        threshold: 2
      });

      await saveHorcruxes(split1.horcruxes, tempDir, nodeAdapter);
      await saveHorcruxes(split2.horcruxes, tempDir, nodeAdapter);

      // Should error due to multiple sets
      await expect(
        autoBind(tempDir, nodeAdapter)
      ).rejects.toThrow('Multiple horcrux sets found');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle minimum configuration (2-of-2)', async () => {
      const data = Buffer.from('Minimal config');

      const splitResult = await splitBuffer(data, 'min.txt', {
        total: 2,
        threshold: 2
      });

      const bindResult = await bindHorcruxes(splitResult.horcruxes);
      expect(bindResult.data).toEqual(data);
    });

    it('should reject mixing horcruxes from different operations', async () => {
      const data = Buffer.from('Same content');

      // Create two separate splits of same data
      const split1 = await splitBuffer(data, 'file.txt', {
        total: 3,
        threshold: 2
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 50));

      const split2 = await splitBuffer(data, 'file.txt', {
        total: 3,
        threshold: 2
      });

      // Mix horcruxes from different splits
      const mixed = [split1.horcruxes[0], split2.horcruxes[1]];

      // Should fail validation due to different timestamps
      await expect(bindHorcruxes(mixed)).rejects.toThrow(
        'Horcruxes are from different split operations'
      );
    });

    it('should handle special characters in filenames', async () => {
      const data = Buffer.from('Special chars test');
      const filename = 'file with spaces & symbols!.txt';

      const splitResult = await splitBuffer(data, filename, {
        total: 3,
        threshold: 2
      });

      const bindResult = await bindHorcruxes(splitResult.horcruxes.slice(0, 2));
      expect(bindResult.filename).toBe(filename);
    });

    it('should preserve binary data integrity', async () => {
      // Create binary data with all byte values
      const binaryData = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }

      const splitResult = await splitBuffer(binaryData, 'binary.dat', {
        total: 5,
        threshold: 3
      });

      const bindResult = await bindHorcruxes(splitResult.horcruxes.slice(1, 4));
      expect(bindResult.data).toEqual(binaryData);
    });
  });

  describe('Performance considerations', () => {
    it('should efficiently handle multiple small files', async () => {
      const operations = [];

      for (let i = 0; i < 10; i++) {
        const data = Buffer.from(`File content ${i}`);
        operations.push(
          splitBuffer(data, `file${i}.txt`, {
            total: 3,
            threshold: 2
          })
        );
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(10);
    });

    it('should validate horcrux format', async () => {
      // Create invalid horcrux file
      const invalidFile = path.join(tempDir, 'invalid.horcrux');
      await writeFile(invalidFile, Buffer.from('Invalid content'));

      // Should throw error when loading
      await expect(
        loadHorcrux(invalidFile, nodeAdapter)
      ).rejects.toThrow('Invalid horcrux file');
    });
  });
});