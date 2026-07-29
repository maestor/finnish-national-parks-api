import { describe, expect, it } from 'vitest';

import { getFrontendUrl } from '../../src/app.js';

describe('year review app helpers', () => {
  it('uses the configured frontend url when available and falls back otherwise', () => {
    expect(
      getFrontendUrl({
        cookieName: '__session',
        frontendUrl: 'https://parks.example.com',
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
        jwtSecret: '12345678901234567890123456789012'
      })
    ).toBe('https://parks.example.com');

    expect(
      getFrontendUrl({
        cookieName: '__session',
        frontendUrl: undefined as unknown as string,
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
        jwtSecret: '12345678901234567890123456789012'
      })
    ).toBe('http://localhost:4300');
    expect(getFrontendUrl()).toBe('http://localhost:4300');
  });
});
