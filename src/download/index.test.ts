import { describe, expect, it } from 'vitest';
import { formatCookieHeader, resolveRedirectUrl } from './index.js';

describe('download helpers', () => {
  it('resolves relative redirects against the original URL', () => {
    expect(resolveRedirectUrl('https://example.com/a/file', '/cdn/file.bin')).toBe('https://example.com/cdn/file.bin');
    expect(resolveRedirectUrl('https://example.com/a/file', '../next')).toBe('https://example.com/next');
  });

  it('formats browser cookies into a Cookie header', () => {
    expect(formatCookieHeader([
      { name: 'sid', value: 'abc', domain: 'example.com' },
      { name: 'ct0', value: 'def', domain: 'example.com' },
    ])).toBe('sid=abc; ct0=def');
  });
});
