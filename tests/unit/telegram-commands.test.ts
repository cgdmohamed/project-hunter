import { describe, expect, it } from 'vitest';
import { parseTelegramCommand } from '../../src/integrations/telegram-commands.js';

describe('Telegram command parsing', () => {
  it('accepts Arabic and slash scan commands', () => {
    expect(parseTelegramCommand('مشاريع')).toBe('scan');
    expect(parseTelegramCommand('/scan')).toBe('scan');
    expect(parseTelegramCommand('/projects@ProjectHunterBot')).toBe('scan');
  });
  it('accepts status and help commands', () => {
    expect(parseTelegramCommand('الحالة')).toBe('status');
    expect(parseTelegramCommand('/stats')).toBe('status');
    expect(parseTelegramCommand('مساعدة')).toBe('help');
  });
  it('ignores unrelated text', () => {
    expect(parseTelegramCommand('hello')).toBeNull();
    expect(parseTelegramCommand('')).toBeNull();
  });
});
