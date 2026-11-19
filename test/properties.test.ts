/**
 * Property-based, metamorphic, differential and boundary tests.
 *
 * Each property runs HORCRUX_PROPERTY_RUNS times (100 by default; the nightly
 * workflow raises it). A failure prints the seed and the shrunk input; rerun
 * it with `fc.assert(..., { seed, path })` and keep the input as an example
 * test next to the property.
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { split, combine, type Share } from '../src/core/shamir/shamir';
import { splitBuffer, splitFile, saveHorcruxes } from '../src/core/split';
import { bindHorcruxes, loadHorcrux } from '../src/core/bind';
import {
  serializeHeader,
  deserializeHeader,
  HORCRUX_MAGIC,
  HORCRUX_BODY_MARKER,
  type HorcruxHeader
} from '../src/core/horcrux';
import { nodeAdapter } from '../src/adapters/node';
import type { PlatformAdapter } from '../src/interfaces/platform';

const runs = Number(process.env.HORCRUX_PROPERTY_RUNS ?? '100');
const params = { numRuns: runs };
// Properties that touch the file system or encrypt payloads run a tenth as often.
const slowParams = { numRuns: Math.max(10, Math.floor(runs / 10)) };

// A Shamir split draws its x-coordinates and coefficients at random, so the
// long runs need more than Jest's default 5 seconds.
jest.setTimeout(Math.max(30_000, runs * 50));

/** Multiplication in GF(2^8) modulo the AES polynomial x^8 + x^4 + x^3 + x + 1, bit by bit. */
function gfMul(a: number, b: number): number {
  let product = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) {
      product ^= x;
    }
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11b;
    }
    y >>= 1;
  }
  return product;
}

/** The inverse of a non-zero element: a^254, since a^255 = 1. */
function gfInv(a: number): number {
  let result = 1;
  for (let i = 0; i < 254; i++) {
    result = gfMul(result, a);
  }
  return result;
}

/** Lagrange interpolation at x = 0, written from the definition, byte by byte. */
function referenceCombine(shares: Share[]): Uint8Array {
  const out = new Uint8Array(shares[0].y.length);
  for (let byte = 0; byte < out.length; byte++) {
    let sum = 0;
    for (const [i, si] of shares.entries()) {
      let basis = 1;
      for (const [j, sj] of shares.entries()) {
        if (i !== j) {
          // l_i(0) = prod x_j / (x_j - x_i); subtraction is XOR in GF(2^8).
          basis = gfMul(basis, gfMul(sj.x, gfInv(sj.x ^ si.x)));
        }
      }
      sum ^= gfMul(si.y[byte], basis);
    }
    out[byte] = sum;
  }
  return out;
}

/** n and a threshold k with 2 <= k <= n <= max. */
const sharing = (max: number): fc.Arbitrary<{ total: number; threshold: number }> =>
  fc
    .integer({ min: 2, max })
    .chain((total) =>
      fc.integer({ min: 2, max: total }).map((threshold) => ({ total, threshold }))
    );

/** Filenames that mix ordinary text with the markers of the file format. */
const filename = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 8 }),
      fc.constantFrom(HORCRUX_MAGIC, HORCRUX_BODY_MARKER, '\n', '"', '\\', '.', '/', 'é', '😀')
    ),
    { minLength: 1, maxLength: 6 }
  )
  .map((parts) => parts.join(''));

/** An adapter whose file system is a Map, so any filename can be stored. */
function memoryAdapter(): PlatformAdapter {
  const files = new Map<string, Buffer>();
  const missing = (p: string): Error => new Error(`no such file: ${p}`);
  return {
    name: 'memory',
    isAvailable: () => true,
    crypto: nodeAdapter.crypto,
    fs: {
      createReadStream: () => Promise.reject(new Error('not used')),
      createWriteStream: () => Promise.reject(new Error('not used')),
      readFile: (p) => {
        const data = files.get(p);
        return data ? Promise.resolve(Buffer.from(data)) : Promise.reject(missing(p));
      },
      writeFile: (p, data) => {
        files.set(p, Buffer.from(data));
        return Promise.resolve();
      },
      exists: (p) => Promise.resolve(files.has(p)),
      stat: (p) => {
        const data = files.get(p);
        if (!data) {
          return Promise.reject(missing(p));
        }
        const now = new Date(0);
        return Promise.resolve({
          size: data.length,
          isFile: true,
          isDirectory: false,
          modifiedTime: now,
          createdTime: now
        });
      },
      readdir: () => Promise.resolve([...files.keys()]),
      unlink: (p) => {
        files.delete(p);
        return Promise.resolve();
      }
    }
  };
}

describe('Shamir secret sharing', () => {
  it('restores the secret from any threshold-sized subset of shares, in any order', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 48 }),
        sharing(12),
        fc.infiniteStream(fc.nat()),
        (secret, { total, threshold }, picks) => {
          const shares = split(secret, total, threshold);
          // Draw a subset of at least threshold shares and shuffle it.
          const pool = [...shares];
          const chosen: Share[] = [];
          const size = threshold + (picks.next().value % (total - threshold + 1));
          while (chosen.length < size) {
            chosen.push(pool.splice(picks.next().value % pool.length, 1)[0]);
          }
          expect(Array.from(combine(chosen))).toEqual(Array.from(secret));
        }
      ),
      params
    );
  });

  it('gives every share a distinct x-coordinate in 1..255', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 4 }), sharing(255), (secret, s) => {
        const xs = split(secret, s.total, s.threshold).map((share) => share.x);
        expect(new Set(xs).size).toBe(s.total);
        expect(xs.every((x) => x >= 1 && x <= 255)).toBe(true);
      }),
      params
    );
  });

  // Differential: combine uses log/exp tables; the reference multiplies bit by
  // bit. Any set of points with distinct x defines one polynomial, so both must
  // agree on f(0) for arbitrary y, not only for shares that split produced.
  it('interpolates f(0) like a bitwise reference for arbitrary points', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 255 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 6 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (xs, length, bytes) => {
          const shares = xs.map((x) => ({
            x,
            y: Uint8Array.from({ length }, () => bytes.next().value)
          }));
          expect(Array.from(combine(shares))).toEqual(Array.from(referenceCombine(shares)));
        }
      ),
      params
    );
  });
});

describe('Split and bind', () => {
  // Metamorphic: the restored bytes do not depend on which shards are given or
  // in which order, and the distributed layout (threshold === total) restores
  // like the replicated one.
  it('restores the data from any threshold-sized subset of horcruxes, in any order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 2048 }),
        sharing(8),
        fc.infiniteStream(fc.nat()),
        async (bytes, { total, threshold }, picks) => {
          const data = Buffer.from(bytes);
          const { horcruxes } = await splitBuffer(data, 'data.bin', { total, threshold });
          const pool = [...horcruxes];
          const chosen = [];
          while (chosen.length < threshold) {
            chosen.push(pool.splice(picks.next().value % pool.length, 1)[0]);
          }
          const restored = await bindHorcruxes(chosen);
          expect(restored.data.equals(data)).toBe(true);
          expect(restored.horcruxesUsed).toBe(threshold);
        }
      ),
      slowParams
    );
  });

  it('stores as many bytes as the data in each replicated shard and in all distributed shards together', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 4096 }), sharing(8), async (bytes, s) => {
        const { horcruxes, totalSize, originalSize } = await splitBuffer(
          Buffer.from(bytes),
          'data.bin',
          s
        );
        expect(originalSize).toBe(bytes.length);
        if (s.threshold === s.total) {
          expect(totalSize).toBe(bytes.length);
        } else {
          expect(horcruxes.every((h) => h.content.length === bytes.length)).toBe(true);
          expect(totalSize).toBe(bytes.length * s.total);
        }
      }),
      slowParams
    );
  });

  // Metamorphic: the same bytes split from a file and from a buffer give the
  // same shard sizes, and either set restores the bytes.
  it('lays out a file like the same bytes in a buffer', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'horcrux-property-'));
    try {
      await fc.assert(
        fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 4096 }), sharing(6), async (bytes, s) => {
          const data = Buffer.from(bytes);
          const input = path.join(dir, 'input.bin');
          await fs.promises.writeFile(input, data);

          const fromFile = await splitFile(input, s, nodeAdapter);
          const fromBuffer = await splitBuffer(data, 'input.bin', s);

          expect(fromFile.horcruxes.map((h) => h.content.length)).toEqual(
            fromBuffer.horcruxes.map((h) => h.content.length)
          );
          const restored = await bindHorcruxes(fromFile.horcruxes.slice(0, s.threshold));
          expect(restored.data.equals(data)).toBe(true);
        }),
        slowParams
      );
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Horcrux file format', () => {
  const header = fc.record({
    originalFilename: filename,
    timestamp: fc.integer({ min: 0, max: 8.64e15 }),
    index: fc.integer({ min: 1, max: 99 }),
    total: fc.integer({ min: 2, max: 99 }),
    threshold: fc.integer({ min: 2, max: 99 }),
    keyFragment: fc.record({
      x: fc.integer({ min: 1, max: 255 }),
      y: fc.uint8Array({ minLength: 32, maxLength: 32 })
    }),
    version: fc.constantFrom('1.0.0', '0.9.0')
  });

  it('reads back every header it writes', () => {
    fc.assert(
      fc.property(header, (h: HorcruxHeader) => {
        const back = deserializeHeader(serializeHeader(h));
        expect({ ...back, keyFragment: { x: back.keyFragment.x, y: Array.from(back.keyFragment.y) } }).toEqual({
          ...h,
          keyFragment: { x: h.keyFragment.x, y: Array.from(h.keyFragment.y) }
        });
      }),
      params
    );
  });

  // Round trip through the file layout: comment, header line, JSON, body line,
  // cipher text. The body may hold any bytes, the markers included.
  it('loads every horcrux it saves, whatever the filename and the body bytes', async () => {
    const body = fc
      .array(fc.oneof(fc.uint8Array({ maxLength: 64 }), fc.constantFrom(Buffer.from(`\n${HORCRUX_BODY_MARKER}\n`), Buffer.from(`\n${HORCRUX_MAGIC}\n`))), { maxLength: 4 })
      .map((parts) => Buffer.concat(parts.map((p) => Buffer.from(p))));

    await fc.assert(
      fc.asyncProperty(header, body, async (h, content) => {
        const adapter = memoryAdapter();
        const [saved] = await saveHorcruxes([{ header: h, content }], 'out', adapter);
        const loaded = await loadHorcrux(saved, adapter);

        expect(loaded.content.equals(content)).toBe(true);
        expect(loaded.header.originalFilename).toBe(h.originalFilename);
        expect(Array.from(loaded.header.keyFragment.y)).toEqual(Array.from(h.keyFragment.y));
      }),
      params
    );
  });

  it('rejects arbitrary bytes with an Error instead of crashing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.uint8Array({ maxLength: 32 }),
            fc.constantFrom(`\n${HORCRUX_MAGIC}\n`, `\n${HORCRUX_BODY_MARKER}\n`, '{', '}', '"keyFragment"', '[1,2]').map((s) => Buffer.from(s))
          ),
          { maxLength: 8 }
        ),
        async (parts) => {
          const adapter = memoryAdapter();
          await adapter.fs.writeFile('x.horcrux', Buffer.concat(parts.map((p) => Buffer.from(p))));
          try {
            await loadHorcrux('x.horcrux', adapter);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        }
      ),
      params
    );
  });
});

describe('Boundaries of the split options', () => {
  const data = Buffer.from('boundary');

  it.each([
    [2, 2],
    [99, 2],
    [99, 99],
    [3, 2]
  ])('accepts total %i with threshold %i', async (total, threshold) => {
    const { horcruxes } = await splitBuffer(data, 'b.txt', { total, threshold });
    expect(horcruxes).toHaveLength(total);
    const restored = await bindHorcruxes(horcruxes.slice(total - threshold));
    expect(restored.data.equals(data)).toBe(true);
  });

  it.each([
    [1, 1, 'Total must be an integer between 2 and 99'],
    [100, 2, 'Total must be an integer between 2 and 99'],
    [2.5, 2, 'Total must be an integer between 2 and 99'],
    [5, 1, 'Threshold must be an integer between 2 and 99'],
    [5, 100, 'Threshold must be an integer between 2 and 99'],
    [5, 2.5, 'Threshold must be an integer between 2 and 99'],
    [3, 4, 'Threshold cannot be greater than total']
  ])('rejects total %p with threshold %p', async (total, threshold, message) => {
    await expect(splitBuffer(data, 'b.txt', { total, threshold })).rejects.toThrow(message);
  });

  it('rejects one horcrux fewer than the threshold and accepts exactly the threshold', async () => {
    const { horcruxes } = await splitBuffer(data, 'b.txt', { total: 5, threshold: 3 });
    await expect(bindHorcruxes(horcruxes.slice(0, 2))).rejects.toThrow(
      'Not enough horcruxes: have 2, need 3'
    );
    expect((await bindHorcruxes(horcruxes.slice(0, 3))).data.equals(data)).toBe(true);
  });
});
