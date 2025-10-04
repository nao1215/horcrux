/**
 * Tests for Shamir's Secret Sharing implementation
 */

import { split, combine, verify } from '../src/core/shamir/shamir';
import * as crypto from 'crypto';

describe('Shamir Secret Sharing', () => {
  describe('split', () => {
    it('should split a secret into shares', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      expect(shares).toHaveLength(5);
      shares.forEach(share => {
        expect(share.x).toBeGreaterThan(0);
        expect(share.x).toBeLessThanOrEqual(255);
        expect(share.y).toHaveLength(secret.length);
      });
    });

    it('should create unique x-coordinates for each share', () => {
      const secret = crypto.randomBytes(16);
      const shares = split(secret, 10, 5);

      const xCoords = shares.map(s => s.x);
      const uniqueCoords = new Set(xCoords);
      expect(uniqueCoords.size).toBe(10);
    });

    it('should throw error when parts < threshold', () => {
      const secret = crypto.randomBytes(16);
      expect(() => split(secret, 2, 3)).toThrow('Parts cannot be less than threshold');
    });

    it('should throw error when parts > 255', () => {
      const secret = crypto.randomBytes(16);
      expect(() => split(secret, 256, 100)).toThrow('Parts cannot exceed 255');
    });

    it('should throw error when threshold < 2', () => {
      const secret = crypto.randomBytes(16);
      expect(() => split(secret, 5, 1)).toThrow('Threshold must be at least 2');
    });

    it('should throw error for empty secret', () => {
      const secret = new Uint8Array(0);
      expect(() => split(secret, 5, 3)).toThrow('Cannot split an empty secret');
    });

    it('should handle minimum configuration (2-of-2)', () => {
      const secret = crypto.randomBytes(16);
      const shares = split(secret, 2, 2);
      expect(shares).toHaveLength(2);
    });

    it('should handle maximum practical configuration', () => {
      const secret = crypto.randomBytes(16);
      const shares = split(secret, 99, 99);
      expect(shares).toHaveLength(99);
    });
  });

  describe('combine', () => {
    it('should reconstruct secret from threshold shares', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      // Use exactly threshold shares
      const recovered = combine(shares.slice(0, 3));
      expect(Buffer.from(recovered)).toEqual(secret);
    });

    it('should reconstruct secret from more than threshold shares', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      // Use all shares
      const recovered = combine(shares);
      expect(Buffer.from(recovered)).toEqual(secret);
    });

    it('should reconstruct with different share combinations', () => {
      const secret = crypto.randomBytes(16);
      const shares = split(secret, 5, 3);

      // Try different combinations of 3 shares
      const combinations = [
        [0, 1, 2],
        [1, 2, 3],
        [0, 2, 4],
        [2, 3, 4]
      ];

      combinations.forEach(indices => {
        const selectedShares = indices.map(i => shares[i]);
        const recovered = combine(selectedShares);
        expect(Buffer.from(recovered)).toEqual(secret);
      });
    });

    it('should handle 2-of-2 threshold', () => {
      const secret = crypto.randomBytes(16);
      const shares = split(secret, 2, 2);
      const recovered = combine(shares);
      expect(Buffer.from(recovered)).toEqual(secret);
    });

    it('should throw error for empty shares array', () => {
      expect(() => combine([])).toThrow('Need at least one share');
    });

    it('should throw error for mismatched share lengths', () => {
      const shares = [
        { x: 1, y: new Uint8Array(10) },
        { x: 2, y: new Uint8Array(15) }
      ];
      expect(() => combine(shares)).toThrow('All shares must have the same length');
    });

    it('should handle large secrets', () => {
      const secret = crypto.randomBytes(1024); // 1KB
      const shares = split(secret, 5, 3);
      const recovered = combine(shares.slice(0, 3));
      expect(Buffer.from(recovered)).toEqual(secret);
    });
  });

  describe('verify', () => {
    it('should verify valid share set', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      expect(verify(shares.slice(0, 3), 3)).toBe(true);
      expect(verify(shares, 3)).toBe(true);
    });

    it('should reject insufficient shares', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      expect(verify(shares.slice(0, 2), 3)).toBe(false);
      expect(verify([shares[0]], 3)).toBe(false);
    });

    it('should handle corrupted shares gracefully', () => {
      const secret = crypto.randomBytes(32);
      const shares = split(secret, 5, 3);

      // Corrupt a share
      shares[0].y[0] = (shares[0].y[0] + 1) % 256;

      // Should still return true as it can combine without error
      // (though the result would be wrong)
      expect(verify(shares.slice(0, 3), 3)).toBe(true);
    });
  });

  describe('integration', () => {
    it('should handle various secret sizes', () => {
      const sizes = [1, 16, 32, 64, 128, 256, 512, 1024];

      sizes.forEach(size => {
        const secret = crypto.randomBytes(size);
        const shares = split(secret, 5, 3);
        const recovered = combine(shares.slice(1, 4)); // Use shares 2, 3, 4
        expect(Buffer.from(recovered)).toEqual(secret);
      });
    });

    it('should produce different shares for same secret', () => {
      const secret = crypto.randomBytes(16);

      const shares1 = split(secret, 3, 2);
      const shares2 = split(secret, 3, 2);

      // Shares should be different due to random polynomial
      expect(shares1[0].y).not.toEqual(shares2[0].y);

      // But both should reconstruct to same secret
      const recovered1 = combine(shares1.slice(0, 2));
      const recovered2 = combine(shares2.slice(0, 2));
      expect(Buffer.from(recovered1)).toEqual(secret);
      expect(Buffer.from(recovered2)).toEqual(secret);
    });

    it('should fail to reconstruct with shares from different splits', () => {
      const secret1 = crypto.randomBytes(16);
      const secret2 = crypto.randomBytes(16);

      const shares1 = split(secret1, 3, 2);
      const shares2 = split(secret2, 3, 2);

      // Mix shares from different splits
      const mixed = [shares1[0], shares2[1]];
      const recovered = combine(mixed);

      // Should not equal either original secret
      expect(Buffer.from(recovered)).not.toEqual(secret1);
      expect(Buffer.from(recovered)).not.toEqual(secret2);
    });
  });
});