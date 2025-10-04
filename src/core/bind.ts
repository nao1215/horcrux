/**
 * Core bind functionality
 * Combines horcruxes back into the original file
 */

import { combine as shamirCombine, type Share } from './shamir/shamir';
import { decrypt } from './crypto/crypto';
import {
  type Horcrux,
  type BindOptions,
  type BindResult,
  deserializeHeader,
  HORCRUX_MAGIC,
  HORCRUX_BODY_MARKER
} from './horcrux';
import type { PlatformAdapter } from '../interfaces/platform';

/**
 * Load and parse a `.horcrux` file from disk. The helper validates the
 * presence of the header/body markers defined in the specification and
 * returns both structured metadata and the encrypted payload.
 *
 * @param filepath Absolute or adapter-relative path to the horcrux file.
 * @param adapter Platform adapter responsible for reading the bytes.
 * @returns In-memory representation of the horcrux file.
 */
export async function loadHorcrux(filepath: string, adapter: PlatformAdapter): Promise<Horcrux> {
  const content = await adapter.fs.readFile(filepath);

  // Find header markers
  const headerStart = content.indexOf(Buffer.from(HORCRUX_MAGIC));
  if (headerStart === -1) {
    throw new Error('Invalid horcrux file: missing header marker');
  }

  const bodyStart = content.indexOf(Buffer.from(HORCRUX_BODY_MARKER));
  if (bodyStart === -1) {
    throw new Error('Invalid horcrux file: missing body marker');
  }

  // Extract header JSON
  const headerJsonStart = headerStart + HORCRUX_MAGIC.length + 1; // +1 for newline
  const headerJson = content.slice(headerJsonStart, bodyStart).toString('utf-8').trim();

  // Parse header
  const header = deserializeHeader(headerJson);

  // Extract body content
  const bodyContentStart = bodyStart + HORCRUX_BODY_MARKER.length + 1; // +1 for newline
  const bodyContent = content.slice(bodyContentStart);

  return {
    header,
    content: bodyContent
  };
}

/**
 * Discover `.horcrux` files in a directory and load them into memory. This is
 * primarily used by {@link autoBind} and mirrors the behaviour of the CLI when
 * operating on a folder of shards.
 *
 * @param directory Directory that may contain horcrux shards.
 * @param adapter Platform adapter used to enumerate and read files.
 * @returns All successfully parsed horcruxes; malformed files are skipped.
 */
export async function findHorcruxes(
  directory: string,
  adapter: PlatformAdapter
): Promise<Horcrux[]> {
  const files = await adapter.fs.readdir(directory);
  const horcruxFiles = files.filter((f) => f.endsWith('.horcrux'));

  const horcruxes: Horcrux[] = [];

  for (const file of horcruxFiles) {
    try {
      const filepath = `${directory}/${file}`;
      const horcrux = await loadHorcrux(filepath, adapter);
      horcruxes.push(horcrux);
    } catch (error) {
      // Skip invalid horcrux files
      console.warn(`Skipping invalid horcrux file: ${file}`, error);
    }
  }

  return horcruxes;
}

/**
 * Ensure that a group of horcruxes can legitimately be combined. The routine
 * checks filename, timestamp, threshold, total count and duplicate indexes so
 * we surface actionable errors before attempting decryption.
 *
 * @param horcruxes Candidate horcruxes selected for binding.
 * @returns `true` when validation passes. An error is thrown on mismatch.
 */
export function validateHorcruxSet(horcruxes: Horcrux[]): boolean {
  if (horcruxes.length === 0) {
    throw new Error('No horcruxes provided');
  }

  const first = horcruxes[0].header;

  for (const horcrux of horcruxes) {
    const header = horcrux.header;

    if (header.originalFilename !== first.originalFilename) {
      throw new Error('Horcruxes are from different files');
    }

    if (header.timestamp !== first.timestamp) {
      throw new Error('Horcruxes are from different split operations');
    }

    if (header.total !== first.total) {
      throw new Error('Horcruxes have inconsistent total count');
    }

    if (header.threshold !== first.threshold) {
      throw new Error('Horcruxes have inconsistent threshold');
    }
  }

  // Check for duplicates
  const indices = new Set(horcruxes.map((h) => h.header.index));
  if (indices.size !== horcruxes.length) {
    throw new Error('Duplicate horcrux indices detected');
  }

  return true;
}

/**
 * Combine a validated set of horcruxes back into the original plaintext. The
 * required number of shards is determined by the recorded threshold and the
 * Shamir key shares are reassembled before decrypting the payload.
 *
 * @param horcruxes Horcrux records returned by {@link loadHorcrux} or
 * {@link findHorcruxes}.
 * @param options Optional overrides like the desired output filename.
 * @returns The restored data buffer and contextual metadata.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function bindHorcruxes(
  horcruxes: Horcrux[],
  options?: BindOptions
): Promise<BindResult> {
  // Validate horcrux set
  validateHorcruxSet(horcruxes);

  const header = horcruxes[0].header;

  // Check if we have enough horcruxes
  if (horcruxes.length < header.threshold) {
    throw new Error(`Not enough horcruxes: have ${horcruxes.length}, need ${header.threshold}`);
  }

  // Use only the required number of horcruxes
  const selectedHorcruxes = horcruxes.slice(0, header.threshold);

  // Extract key shares
  const keyShares: Share[] = selectedHorcruxes.map((h) => h.header.keyFragment);

  // Reconstruct the encryption key
  const key = Buffer.from(shamirCombine(keyShares));

  // Decrypt and combine content
  let decryptedData: Buffer;

  if (header.threshold === header.total) {
    // Content was distributed across horcruxes
    decryptedData = combineMultiplexed(selectedHorcruxes, key);
  } else {
    // Content was replicated in each horcrux
    decryptedData = combineReplicated(selectedHorcruxes[0], key);
  }

  // Apply options
  const filename = options?.outputFilename ?? header.originalFilename;

  return {
    data: decryptedData,
    filename,
    horcruxesUsed: selectedHorcruxes.length
  };
}

/**
 * Combine multiplexed content (threshold === total)
 */
function combineMultiplexed(horcruxes: Horcrux[], key: Buffer): Buffer {
  // Sort horcruxes by index to ensure correct order
  const sortedHorcruxes = [...horcruxes].sort((a, b) => a.header.index - b.header.index);

  // Concatenate all content in order
  const encryptedData = Buffer.concat(sortedHorcruxes.map((h) => h.content));

  // Decrypt the combined content
  return decrypt(encryptedData, key);
}

/**
 * Combine replicated content (threshold < total)
 */
function combineReplicated(horcrux: Horcrux, key: Buffer): Buffer {
  // All horcruxes have the same content, so use the first one
  return decrypt(horcrux.content, key);
}

/**
 * High-level helper that loads horcrux files, reconstructs the payload and
 * writes the decrypted bytes to disk in one step. This mirrors the default
 * workflow of the CLI interface.
 *
 * @param horcruxPaths Path list pointing to the shards to consume.
 * @param outputPath Destination file path for the restored payload.
 * @param adapter Platform adapter used for all file IO.
 * @param options Optional bind options forwarded to {@link bindHorcruxes}.
 * @returns Details about the restored file, including how many shards were used.
 */
export async function bindFiles(
  horcruxPaths: string[],
  outputPath: string,
  adapter: PlatformAdapter,
  options?: BindOptions
): Promise<BindResult> {
  // Load horcruxes
  const horcruxes: Horcrux[] = [];
  for (const path of horcruxPaths) {
    const horcrux = await loadHorcrux(path, adapter);
    horcruxes.push(horcrux);
  }

  // Bind horcruxes
  const result = await bindHorcruxes(horcruxes, options);

  // Save the result
  await adapter.fs.writeFile(outputPath, result.data);

  return result;
}

/**
 * Automatically locate a compatible set of horcruxes in the given directory
 * and bind them. If multiple split runs are present the function signals an
 * error so the caller can disambiguate.
 *
 * @param directory Directory to scan for `.horcrux` files.
 * @param adapter Platform adapter providing filesystem access.
 * @param options Optional bind options forwarded to {@link bindHorcruxes}.
 * @returns Bind result for the single detected horcrux set.
 */
export async function autoBind(
  directory: string,
  adapter: PlatformAdapter,
  options?: BindOptions
): Promise<BindResult> {
  // Find all horcrux files
  const horcruxes = await findHorcruxes(directory, adapter);

  if (horcruxes.length === 0) {
    throw new Error('No horcrux files found in directory');
  }

  // Group by original file and timestamp
  const groups = new Map<string, Horcrux[]>();

  for (const horcrux of horcruxes) {
    const key = `${horcrux.header.originalFilename}_${horcrux.header.timestamp}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    const group = groups.get(key);
    if (group) {
      group.push(horcrux);
    }
  }

  // If multiple groups, need user to specify which one
  if (groups.size > 1) {
    const files = Array.from(groups.keys()).map((k) => k.split('_')[0]);
    throw new Error(
      `Multiple horcrux sets found for files: ${files.join(', ')}. Please specify which horcruxes to use.`
    );
  }

  // Use the single group found
  const [horcruxSet] = Array.from(groups.values());

  // Bind the horcruxes
  return bindHorcruxes(horcruxSet, options);
}
