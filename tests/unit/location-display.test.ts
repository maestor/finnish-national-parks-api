import { describe, expect, it } from 'vitest';

import {
  deriveDisplayNameFromLabel,
  deriveLocationDisplayName
} from '../../src/location-display.js';

describe('location display helpers', () => {
  it('prefers name, then address line, then formatted text', () => {
    expect(
      deriveLocationDisplayName({
        addressLine1: 'Halmekuja 1',
        formatted: 'Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland',
        name: 'Neste Vantaa Koivukyla'
      })
    ).toBe('Neste Vantaa Koivukyla');

    expect(
      deriveLocationDisplayName({
        addressLine1: 'Halmekuja 1',
        formatted: 'Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland',
        name: '   '
      })
    ).toBe('Halmekuja 1');

    expect(
      deriveLocationDisplayName({
        addressLine1: '   ',
        formatted: 'Helsinki, Finland',
        name: '   '
      })
    ).toBe('Helsinki, Finland');
  });

  it('derives the first non-empty label segment and handles empty labels safely', () => {
    expect(
      deriveDisplayNameFromLabel('Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland')
    ).toBe('Neste Vantaa Koivukyla');

    expect(deriveDisplayNameFromLabel('Single label')).toBe('Single label');
    expect(deriveDisplayNameFromLabel('   ')).toBe('');
    expect(deriveDisplayNameFromLabel(' , , ')).toBe(', ,');
  });
});
