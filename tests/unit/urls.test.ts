import { describe, expect, it } from 'vitest';
import {
  canonicalProjectUrl,
  extractProjectIdFromUrl,
  isSameOrigin,
  resolveUrl,
} from '../../src/utils/urls.js';

describe('url utils', () => {
  const BASE = 'https://mostaql.com';

  it('resolves relative and absolute URLs', () => {
    expect(resolveUrl('/project/abc-1', BASE)).toBe('https://mostaql.com/project/abc-1');
    expect(resolveUrl('https://mostaql.com/project/abc-2', BASE)).toBe(
      'https://mostaql.com/project/abc-2',
    );
  });

  it('rejects javascript and hash links', () => {
    expect(resolveUrl('javascript:void(0)', BASE)).toBeNull();
    expect(resolveUrl('#section', BASE)).toBeNull();
    expect(resolveUrl('', BASE)).toBeNull();
    expect(resolveUrl(null, BASE)).toBeNull();
  });

  it('extracts the project id', () => {
    expect(extractProjectIdFromUrl('https://mostaql.com/project/xyz-123')).toBe('xyz-123');
    expect(extractProjectIdFromUrl('https://mostaql.com/projects')).toBeNull();
    expect(extractProjectIdFromUrl('not a url')).toBeNull();
  });

  it('compares origins', () => {
    expect(isSameOrigin('https://mostaql.com/project/1', BASE)).toBe(true);
    expect(isSameOrigin('https://evil.com/project/1', BASE)).toBe(false);
  });

  it('strips query strings and hashes from canonical urls', () => {
    expect(canonicalProjectUrl('https://mostaql.com/project/1?utm=x#frag')).toBe(
      'https://mostaql.com/project/1',
    );
  });
});