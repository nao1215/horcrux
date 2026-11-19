/**
 * Example tests for the file naming helpers and the checks bind runs before
 * decrypting. Several of them were added for mutants that survived the first
 * mutation run (see doc/testing.md).
 */

import { formatHorcruxFilename, parseHorcruxFilename, type Horcrux } from '../src/core/horcrux';
import { splitBuffer, splitFile } from '../src/core/split';
import { bindHorcruxes, validateHorcruxSet } from '../src/core/bind';
import type { PlatformAdapter } from '../src/interfaces/platform';
import { nodeAdapter } from '../src/adapters/node';

describe('formatHorcruxFilename', () => {
  it.each([
    ['secret.pdf', 'secret_2_of_5.horcrux'],
    ['archive.tar.gz', 'archive.tar_2_of_5.horcrux'],
    ['README', 'README_2_of_5.horcrux'],
    ['dir.d/notes', 'dir.d/notes_2_of_5.horcrux']
  ])('drops only the last extension of %j', (name, expected) => {
    expect(formatHorcruxFilename(name, 2, 5)).toBe(expected);
  });

  it('fills the placeholders of a custom pattern', () => {
    expect(formatHorcruxFilename('a.txt', 3, 4, '{filename}-{index}-{total}.hx')).toBe('a.txt-3-4.hx');
  });

  it('uses the default shape for an empty pattern', () => {
    expect(formatHorcruxFilename('a.txt', 1, 2, '')).toBe('a_1_of_2.horcrux');
  });
});

describe('parseHorcruxFilename', () => {
  it('reads the name, index and total of the default shape', () => {
    expect(parseHorcruxFilename('my_backup_12_of_99.horcrux')).toEqual({
      originalFilename: 'my_backup',
      index: 12,
      total: 99
    });
  });

  it.each([
    'backup_1_of_5.horcrux.bak',
    'backup_1_of_5.horcrux!',
    '_1_of_5.horcrux',
    'backup_a_of_5.horcrux',
    'backup_1_of_b.horcrux',
    'backup_1_of_5.txt'
  ])('returns null for %j', (name) => {
    expect(parseHorcruxFilename(name)).toBeNull();
  });
});

describe('splitBuffer and splitFile headers', () => {
  it('numbers the horcruxes from 1 to total', async () => {
    const { horcruxes } = await splitBuffer(Buffer.from('x'), 'x.txt', { total: 4, threshold: 3 });
    expect(horcruxes.map((h) => h.header.index)).toEqual([1, 2, 3, 4]);
    expect(horcruxes.every((h) => h.header.total === 4 && h.header.threshold === 3)).toBe(true);
  });

  const adapterWith = (isFile: boolean): PlatformAdapter => ({
    name: 'stub',
    isAvailable: () => true,
    crypto: nodeAdapter.crypto,
    fs: {
      ...nodeAdapter.fs,
      stat: () =>
        Promise.resolve({ size: 3, isFile, isDirectory: !isFile, modifiedTime: new Date(0), createdTime: new Date(0) }),
      readFile: () => Promise.resolve(Buffer.from('abc'))
    }
  });

  it('records the last part of a Windows path as the original filename', async () => {
    const result = await splitFile('C:\\Users\\me\\secret.txt', { total: 2, threshold: 2 }, adapterWith(true));
    expect(result.horcruxes[0].header.originalFilename).toBe('secret.txt');
  });

  it('rejects a path that is not a file', async () => {
    await expect(splitFile('/tmp', { total: 2, threshold: 2 }, adapterWith(false))).rejects.toThrow(
      'Input path is not a file'
    );
  });
});

describe('validateHorcruxSet', () => {
  async function set(): Promise<Horcrux[]> {
    return (await splitBuffer(Buffer.from('payload'), 'p.txt', { total: 3, threshold: 2 })).horcruxes;
  }
  const withHeader = (h: Horcrux, change: Partial<Horcrux['header']>): Horcrux => ({
    ...h,
    header: { ...h.header, ...change }
  });

  it('accepts horcruxes of one split', async () => {
    expect(validateHorcruxSet(await set())).toBe(true);
  });

  it('rejects an empty list', () => {
    expect(() => validateHorcruxSet([])).toThrow('No horcruxes provided');
  });

  it.each([
    [{ originalFilename: 'other.txt' }, 'Horcruxes are from different files'],
    [{ timestamp: 1 }, 'Horcruxes are from different split operations'],
    [{ total: 4 }, 'Horcruxes have inconsistent total count'],
    [{ threshold: 3 }, 'Horcruxes have inconsistent threshold'],
    [{ index: 1 }, 'Duplicate horcrux indices detected']
  ])('rejects a second horcrux whose header differs by %j', async (change, message) => {
    const [first, second] = await set();
    expect(() => validateHorcruxSet([first, withHeader(second, change)])).toThrow(message);
    await expect(bindHorcruxes([first, withHeader(second, change)])).rejects.toThrow(message);
  });
});
