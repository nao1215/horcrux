/**
 * Horcrux TypeScript Library
 * A file splitting and encryption library inspired by Harry Potter
 *
 * @packageDocumentation
 */

// Core exports - Public API only
export { splitFile, splitBuffer } from './core/split';
export { bindFiles, autoBind } from './core/bind';

// Type exports
export type { SplitOptions, SplitResult, BindOptions, BindResult } from './core/horcrux';

// Platform adapter exports
export { nodeAdapter } from './adapters/node';
export { reactNativeAdapter, configureReactNative } from './adapters/react-native';

// Default adapter based on environment
import { nodeAdapter } from './adapters/node';
import { reactNativeAdapter } from './adapters/react-native';
import { splitFile } from './core/split';
import { bindFiles, autoBind } from './core/bind';
import type { SplitResult, BindResult } from './core/horcrux';
import type { PlatformAdapter } from './interfaces/platform';

/**
 * Get the default platform adapter for the current environment
 * @internal This is an internal function
 */
function getDefaultAdapter(): PlatformAdapter {
  if (nodeAdapter.isAvailable()) {
    return nodeAdapter;
  } else if (reactNativeAdapter.isAvailable()) {
    return reactNativeAdapter;
  }
  throw new Error('No compatible platform adapter found');
}

/**
 * High-level convenience API that discovers the appropriate platform adapter
 * (Node.js or React Native) and splits the given file into encrypted
 * horcruxes. Uses the same defaults as the Go CLI implementation.
 *
 * @param inputPath Path to the file to split.
 * @param total Total number of horcruxes to create (2-99 as per spec).
 * @param threshold Minimum number of horcruxes required to restore.
 * @returns Split result including headers, cipher text and size metadata.
 */
export async function split(
  inputPath: string,
  total: number,
  threshold: number
): Promise<SplitResult> {
  const adapter = getDefaultAdapter();
  return splitFile(inputPath, { total, threshold }, adapter);
}

/**
 * Restore a file from a set of `.horcrux` shards, automatically selecting the
 * best available platform adapter. The function loads each shard, validates
 * the set and writes the decrypted payload to the supplied `outputPath`.
 *
 * @param horcruxPaths Array of horcrux file paths to combine.
 * @param outputPath Destination file path for the restored data.
 * @returns Bind result that includes the recovered filename and shard count.
 */
export async function bind(horcruxPaths: string[], outputPath: string): Promise<BindResult> {
  const adapter = getDefaultAdapter();
  return bindFiles(horcruxPaths, outputPath, adapter);
}

/**
 * Convenience wrapper that scans a directory for a compatible horcrux set and
 * restores it using the default adapter. Errors if multiple independent split
 * runs are found so callers can resolve the ambiguity.
 *
 * @param directory Directory containing horcrux files.
 * @returns Bind result for the single detected horcrux set.
 */
export async function autoBindDirectory(directory: string): Promise<BindResult> {
  const adapter = getDefaultAdapter();
  return autoBind(directory, adapter);
}

// Version information
export const VERSION = '0.0.3';

/**
 * Library metadata
 */
export const metadata = {
  name: 'horcrux',
  version: VERSION,
  description: 'A TypeScript library for splitting files into encrypted fragments',
  author: 'nao1215',
  repository: 'https://github.com/nao1215/horcrux'
};
