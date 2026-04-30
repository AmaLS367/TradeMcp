import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encrypt, decrypt } from './mcp';

// Mock process.env
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Encryption Helpers', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', ENCRYPTION_KEY);
  });

  it('should encrypt and decrypt text correctly', () => {
    const text = 'hello-world-123';
    const encrypted = encrypt(text);
    
    expect(encrypted).toBeDefined();
    expect(typeof encrypted).toBe('string');
    expect(encrypted).toContain(':');
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should produce different ciphertexts for the same input (due to IV)', () => {
    const text = 'constant-text';
    const encrypted1 = encrypt(text);
    const encrypted2 = encrypt(text);
    
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should throw error if ENCRYPTION_KEY is missing or invalid', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'short-key');
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
    
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => decrypt('iv:tag:data')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
  });

  it('should throw error for invalid ciphertext format', () => {
    expect(() => decrypt('invalidformat')).toThrow('Invalid ciphertext format');
    expect(() => decrypt('iv:tag')).toThrow('Invalid ciphertext format');
  });
});
