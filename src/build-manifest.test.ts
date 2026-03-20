import { describe, expect, it } from 'vitest';
import { parseTsArgsBlock } from './build-manifest.js';

describe('parseTsArgsBlock', () => {
  it('keeps args with nested choices arrays', () => {
    const args = parseTsArgsBlock(`
      {
        name: 'period',
        type: 'string',
        default: 'seven',
        help: 'Stats period: seven or thirty',
        choices: ['seven', 'thirty'],
      },
    `);

    expect(args).toEqual([
      {
        name: 'period',
        type: 'string',
        default: 'seven',
        required: false,
        positional: undefined,
        help: 'Stats period: seven or thirty',
        choices: ['seven', 'thirty'],
      },
    ]);
  });

  it('keeps hyphenated arg names from TS adapters', () => {
    const args = parseTsArgsBlock(`
      {
        name: 'tweet-url',
        help: 'Single tweet URL to download',
      },
      {
        name: 'download-images',
        type: 'boolean',
        default: false,
        help: 'Download images locally',
      },
    `);

    expect(args).toEqual([
      {
        name: 'tweet-url',
        type: 'str',
        default: undefined,
        required: false,
        positional: undefined,
        help: 'Single tweet URL to download',
        choices: undefined,
      },
      {
        name: 'download-images',
        type: 'boolean',
        default: false,
        required: false,
        positional: undefined,
        help: 'Download images locally',
        choices: undefined,
      },
    ]);
  });
});
