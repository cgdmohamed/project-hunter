import { describe, expect, it } from 'vitest';
import { contentHash, fingerprint, sha256 } from '../../src/utils/hash.js';

describe('content hashing', () => {
  it('is deterministic regardless of key order', () => {
    const a = contentHash({ title: 'x', budget: 100 });
    const b = contentHash({ budget: 100, title: 'x' });
    expect(a).toBe(b);
  });

  it('changes when meaningful content changes', () => {
    const before = contentHash({ title: 'x', budget: 100 });
    const after = contentHash({ title: 'x', budget: 200 });
    expect(before).not.toBe(after);
  });

  it('normalises null/undefined to empty', () => {
    expect(contentHash({ a: null })).toBe(contentHash({ a: undefined }));
  });

  it('produces short stable fingerprints', () => {
    expect(fingerprint({ title: 'x' }).length).toBe(24);
    expect(fingerprint({ title: 'x' })).toBe(fingerprint({ title: 'x' }));
  });

  it('sha256 is a 64-char hex digest', () => {
    expect(sha256('hello')).toMatch(/^[a-f0-9]{64}$/);
  });
});