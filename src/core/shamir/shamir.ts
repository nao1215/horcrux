/**
 * Shamir's Secret Sharing implementation
 * Splits a secret into n shares where any k shares can reconstruct the secret
 * Uses polynomial interpolation over GF(2^8) finite field
 */

import { logTable, expTable } from './tables';
import * as crypto from 'crypto';

/**
 * Represents a single share of the secret
 */
export interface Share {
  x: number; // X-coordinate (1-255)
  y: Uint8Array; // Y-coordinates for each byte of the secret
}

/**
 * Add two numbers in GF(2^8)
 * Addition in GF(2^8) is XOR operation
 */
function add(a: number, b: number): number {
  return a ^ b;
}

/**
 * Multiply two numbers in GF(2^8) using log/exp tables
 * Special case: multiplication by 0 always yields 0
 */
function mult(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  const logA = logTable[a];
  const logB = logTable[b];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (logA === undefined || logB === undefined) {
    throw new Error(`Invalid values for GF(2^8) multiplication: ${a}, ${b}`);
  }
  const logSum = (logA + logB) % 255;
  const result = expTable[logSum];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (result === undefined) {
    throw new Error(`Invalid expTable index: ${logSum}`);
  }
  return result;
}

/**
 * Divide two numbers in GF(2^8)
 * Division is multiplication by the multiplicative inverse
 */
function div(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  if (a === 0) {
    return 0;
  }
  const logA = logTable[a];
  const logB = logTable[b];
  const logDiff = (logA - logB + 255) % 255;
  return expTable[logDiff];
}

/**
 * Evaluate polynomial at a given x using Horner's method
 * coeffs[0] + coeffs[1]*x + coeffs[2]*x^2 + ...
 */
function eval_poly(coeffs: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = add(mult(result, x), coeffs[i]);
  }
  return result;
}

/**
 * Split a secret into multiple shares using Shamir's Secret Sharing over
 * GF(2^8). The resulting shares are compatible with the legacy Horcrux CLI,
 * meaning that any combination of `threshold` shares can perfectly restore the
 * original key material.
 *
 * @param secret The secret data to split.
 * @param parts Total number of shares to create.
 * @param threshold Minimum number of shares needed to reconstruct.
 * @returns Array of shares ready to embed in horcrux headers.
 */
export function split(secret: Uint8Array, parts: number, threshold: number): Share[] {
  if (parts < threshold) {
    throw new Error('Parts cannot be less than threshold');
  }
  if (parts > 255) {
    throw new Error('Parts cannot exceed 255');
  }
  if (threshold < 2) {
    throw new Error('Threshold must be at least 2');
  }
  if (threshold > 255) {
    throw new Error('Threshold cannot exceed 255');
  }
  if (secret.length === 0) {
    throw new Error('Cannot split an empty secret');
  }

  // Generate random x-coordinates (1-255, 0 is reserved)
  const xCoords = new Set<number>();
  while (xCoords.size < parts) {
    const x = (crypto.randomBytes(1)[0] % 255) + 1;
    xCoords.add(x);
  }
  const xs = Array.from(xCoords);

  const shares: Share[] = [];

  // Create polynomial coefficients for each byte of the secret
  // Store them to ensure consistency across all shares
  const polynomials: Uint8Array[] = [];

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Create random polynomial coefficients
    // coeffs[0] is the secret byte
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[byteIdx];

    // Generate random coefficients for degrees 1 to threshold-1
    for (let i = 1; i < threshold; i++) {
      coeffs[i] = crypto.randomBytes(1)[0];
    }

    polynomials.push(coeffs);
  }

  // For each x-coordinate, create a share
  for (const x of xs) {
    const y = new Uint8Array(secret.length);

    // Evaluate each polynomial at x
    for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
      y[byteIdx] = eval_poly(polynomials[byteIdx], x);
    }

    shares.push({ x, y });
  }

  return shares;
}

/**
 * Combine shares to reconstruct the original secret. Internally this performs
 * Lagrange interpolation at x=0 to recover the constant term of the random
 * polynomial that was used in {@link split}.
 *
 * @param shares Array of shares to combine.
 * @returns The reconstructed secret with the original length.
 */
export function combine(shares: Share[]): Uint8Array {
  if (shares.length === 0) {
    throw new Error('Need at least one share');
  }

  const secretLength = shares[0].y.length;

  // Verify all shares have the same length
  for (const share of shares) {
    if (share.y.length !== secretLength) {
      throw new Error('All shares must have the same length');
    }
  }

  const secret = new Uint8Array(secretLength);

  // Process each byte position
  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    const points: { x: number; y: number }[] = [];

    // Collect points for this byte position
    for (const share of shares) {
      points.push({
        x: share.x,
        y: share.y[byteIdx]
      });
    }

    // Use Lagrange interpolation to find f(0)
    let result = 0;

    for (let i = 0; i < points.length; i++) {
      let numerator = 1;
      let denominator = 1;

      for (let j = 0; j < points.length; j++) {
        if (i === j) {
          continue;
        }

        // Build Lagrange basis polynomial
        numerator = mult(numerator, points[j].x);
        denominator = mult(denominator, add(points[i].x, points[j].x));
      }

      // Add contribution from this basis polynomial
      const term = mult(points[i].y, div(numerator, denominator));
      result = add(result, term);
    }

    secret[byteIdx] = result;
  }

  return secret;
}

/**
 * Lightweight validation helper that checks whether a collection of shares is
 * sufficient to rebuild the secret without throwing. Used primarily in tests
 * and defensive checks.
 *
 * @param shares Array of shares to verify.
 * @param threshold Minimum number of shares needed.
 * @returns `true` if the shares appear valid, `false` otherwise.
 */
export function verify(shares: Share[], threshold: number): boolean {
  if (shares.length < threshold) {
    return false;
  }

  try {
    // Try to combine the shares
    const secret = combine(shares.slice(0, threshold));
    return secret.length > 0;
  } catch {
    return false;
  }
}
