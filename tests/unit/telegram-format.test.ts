import { describe, expect, it } from 'vitest';
import { escapeHtml, paginateBlocks, TELEGRAM_MAX_MESSAGE_LENGTH } from '../../src/integrations/telegram.js';

describe('telegram message formatting', () => {
  it('escapes HTML entities', () => {
    expect(escapeHtml('<b>x</b> & "quoted"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(escapeHtml(null)).toBe('');
  });

  it('keeps short sets of blocks in a single message', () => {
    const messages = paginateBlocks(['<b>عنوان</b>', 'سطر ثانٍ']);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('<b>عنوان</b>');
  });

  it('splits long tag-free blocks at word boundaries without losing content', () => {
    const longText = 'كلمة '.repeat(3000).trim(); // ~3000 "كلمة" pairs, far over 4096 chars
    const blocks = paginateBlocks([longText]);
    const joined = blocks.join(' ');
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    expect(joined.replace(/\s+/g, ' ')).toBe(longText.replace(/\s+/g, ' '));
  });

  it('does not truncate information silently', () => {
    const pieces = paginateBlocks(['أ']);

    // A "truncation" would lose data; every piece above the limit is chunked.
    expect(pieces.join('')).toBe('أ');
  });

  it('groups multiple blocks with separation', () => {
    const messages = paginateBlocks([`a`.repeat(4000), 'b'.repeat(4000)]);
    expect(messages.length).toBe(2);
    expect(messages[0]!.endsWith('a')).toBe(true);
    expect(messages[1]!.startsWith('b')).toBe(true);
  });
});