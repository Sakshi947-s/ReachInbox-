import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/utils/crypto.js';

describe('Crypto Utility', () => {
  it('should encrypt and decrypt a sensitive token reliably', () => {
    const rawToken = 'xoxb-123456789-abcdefghijklmnop';
    const encrypted = encrypt(rawToken);

    expect(encrypted).not.toBe(rawToken);
    expect(encrypted).toContain(':');

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('should throw an error when decrypting malformed ciphertext', () => {
    expect(() => decrypt('invalid-format')).toThrow('Invalid encrypted format');
  });

  it('should return empty string for empty input', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });
});
