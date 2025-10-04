/**
 * Core split functionality
 * Splits a file into multiple encrypted horcruxes
 */

import { split as shamirSplit } from './shamir/shamir';
import { generateKey, createEncryptStream, encrypt } from './crypto/crypto';
import { Demultiplexer } from './multiplexing';
import {
  type Horcrux,
  type HorcruxHeader,
  type SplitOptions,
  type SplitResult,
  HORCRUX_VERSION,
  formatHorcruxFilename,
  createHorcruxComment,
  serializeHeader,
  HORCRUX_MAGIC,
  HORCRUX_BODY_MARKER
} from './horcrux';
import type { PlatformAdapter } from '../interfaces/platform';
import { Writable, pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

/**
 * Split a file into multiple horcrux shards as described in the Horcrux
 * specification. The content is encrypted with AES-256-OFB and the symmetric
 * key is dispersed using Shamir's Secret Sharing. When `threshold === total`
 * the payload is multiplexed across shards to minimise storage; otherwise the
 * encrypted payload is replicated so any `threshold` files can restore the
 * original.
 *
 * @param inputPath Absolute or adapter-relative path to the source file.
 * @param options Required split options including shard count and threshold.
 * @param adapter Platform adapter that provides file system primitives.
 * @returns Structured information about the generated horcruxes.
 */
export async function splitFile(
  inputPath: string,
  options: SplitOptions,
  adapter: PlatformAdapter
): Promise<SplitResult> {
  // Validate options
  validateSplitOptions(options);

  // Get file info
  const stats = await adapter.fs.stat(inputPath);
  if (!stats.isFile) {
    throw new Error('Input path is not a file');
  }

  // Extract filename (normalise Windows separators before splitting)
  const filename = inputPath.replace(/\\+/g, '/').split('/').pop() ?? inputPath;

  // Generate encryption key
  const key = generateKey();

  // Split key using Shamir's Secret Sharing
  const keyShares = shamirSplit(new Uint8Array(key), options.total, options.threshold);

  // Create horcrux headers
  const timestamp = Date.now();
  const headers: HorcruxHeader[] = keyShares.map((share, index) => ({
    originalFilename: filename,
    timestamp,
    index: index + 1,
    total: options.total,
    threshold: options.threshold,
    keyFragment: share,
    version: HORCRUX_VERSION
  }));

  // Encrypt and distribute file content
  const horcruxes: Horcrux[] = [];

  if (options.threshold === options.total) {
    // Space-efficient mode: distribute encrypted content across horcruxes
    horcruxes.push(...(await splitWithMultiplexing(inputPath, headers, key, adapter)));
  } else {
    // Redundant mode: copy encrypted content to all horcruxes
    horcruxes.push(...(await splitWithReplication(inputPath, headers, key, adapter)));
  }

  // Calculate total size
  const totalSize = horcruxes.reduce((sum, h) => sum + h.content.length, 0);

  return {
    horcruxes,
    originalSize: stats.size,
    totalSize
  };
}

/**
 * In-memory variant of {@link splitFile} for callers that already hold the
 * payload in a buffer (for example when streaming uploads). Behaviour matches
 * the file-based API, including encryption, key sharing and multiplex versus
 * replication logic.
 *
 * @param data Raw bytes to be protected.
 * @param filename Logical filename recorded in the horcrux headers.
 * @param options Configuration shared with the file-based splitter.
 * @returns Metadata and horcrux buffers that can later be persisted.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function splitBuffer(
  data: Buffer,
  filename: string,
  options: SplitOptions
): Promise<SplitResult> {
  // Validate options
  validateSplitOptions(options);

  // Generate encryption key
  const key = generateKey();

  // Split key using Shamir's Secret Sharing
  const keyShares = shamirSplit(new Uint8Array(key), options.total, options.threshold);

  // Create horcrux headers
  const timestamp = Date.now();
  const headers: HorcruxHeader[] = keyShares.map((share, index) => ({
    originalFilename: filename,
    timestamp,
    index: index + 1,
    total: options.total,
    threshold: options.threshold,
    keyFragment: share,
    version: HORCRUX_VERSION
  }));

  // Encrypt the data
  const encryptedData = encrypt(data, key);

  // Create horcruxes
  const horcruxes: Horcrux[] = [];

  if (options.threshold === options.total) {
    // Space-efficient mode: distribute encrypted content
    const chunkSize = Math.ceil(encryptedData.length / options.total);

    for (let i = 0; i < headers.length; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, encryptedData.length);
      const content = encryptedData.slice(start, end);

      horcruxes.push({
        header: headers[i],
        content
      });
    }
  } else {
    // Redundant mode: copy encrypted content to all horcruxes
    for (const header of headers) {
      horcruxes.push({
        header,
        content: Buffer.from(encryptedData)
      });
    }
  }

  // Calculate total size
  const totalSize = horcruxes.reduce((sum, h) => sum + h.content.length, 0);

  return {
    horcruxes,
    originalSize: data.length,
    totalSize
  };
}

/**
 * Split with multiplexing (threshold === total)
 */
async function splitWithMultiplexing(
  inputPath: string,
  headers: HorcruxHeader[],
  key: Buffer,
  adapter: PlatformAdapter
): Promise<Horcrux[]> {
  const inputStream = await adapter.fs.createReadStream(inputPath);
  const encryptStream = createEncryptStream(key);

  // Create memory buffers for each horcrux content
  const contentBuffers: Buffer[][] = headers.map(() => []);

  // Create writable streams for each horcrux
  const outputStreams = headers.map((_, index) => {
    return new Writable({
      write(chunk: Buffer, _encoding, callback): void {
        contentBuffers[index].push(chunk);
        callback();
      }
    });
  });

  // Create demultiplexer
  const demux = Demultiplexer.createTransform(outputStreams);

  // Pipeline: input -> encrypt -> demultiplex -> outputs
  await pipelineAsync(inputStream, encryptStream, demux);

  // Create horcruxes with collected content
  return headers.map((header, index) => ({
    header,
    content: Buffer.concat(contentBuffers[index])
  }));
}

/**
 * Split with replication (threshold < total)
 */
async function splitWithReplication(
  inputPath: string,
  headers: HorcruxHeader[],
  key: Buffer,
  adapter: PlatformAdapter
): Promise<Horcrux[]> {
  // Read and encrypt entire file
  const inputData = await adapter.fs.readFile(inputPath);
  const encryptedData = encrypt(inputData, key);

  // Create horcruxes with replicated content
  return headers.map((header) => ({
    header,
    content: Buffer.from(encryptedData)
  }));
}

/**
 * Validate split options
 */
function validateSplitOptions(options: SplitOptions): void {
  const { total, threshold } = options;

  if (!Number.isInteger(total) || total < 2 || total > 99) {
    throw new Error('Total must be an integer between 2 and 99');
  }

  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 99) {
    throw new Error('Threshold must be an integer between 2 and 99');
  }

  if (threshold > total) {
    throw new Error('Threshold cannot be greater than total');
  }
}

/**
 * Persist a set of horcruxes to disk using the adapter's file system. Each
 * output file contains a human-readable comment, the JSON-encoded header and
 * the encrypted payload markers mandated by the original CLI.
 *
 * @param horcruxes Collection of horcrux structures produced by a split call.
 * @param outputDir Directory path where `.horcrux` files should be written.
 * @param adapter Platform adapter used to create and write the files.
 * @returns The concrete file paths that were created.
 */
export async function saveHorcruxes(
  horcruxes: Horcrux[],
  outputDir: string,
  adapter: PlatformAdapter
): Promise<string[]> {
  const savedPaths: string[] = [];

  for (const horcrux of horcruxes) {
    const filename = formatHorcruxFilename(
      horcrux.header.originalFilename,
      horcrux.header.index,
      horcrux.header.total
    );

    const filepath = `${outputDir}/${filename}`;

    // Create file content with header and body
    const comment = createHorcruxComment(horcrux.header.index, horcrux.header.total);
    const headerJson = serializeHeader(horcrux.header);

    const fileContent = Buffer.concat([
      Buffer.from(comment, 'utf-8'),
      Buffer.from(`\n${HORCRUX_MAGIC}\n`, 'utf-8'),
      Buffer.from(headerJson, 'utf-8'),
      Buffer.from(`\n${HORCRUX_BODY_MARKER}\n`, 'utf-8'),
      horcrux.content
    ]);

    await adapter.fs.writeFile(filepath, fileContent);
    savedPaths.push(filepath);
  }

  return savedPaths;
}
