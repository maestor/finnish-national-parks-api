import { describe, expect, it } from 'vitest';
import { validateOAuthReturnPath } from '../../src/http/oauth-return.js';

const frontendUrl = 'https://parks.example.com';

describe('OAuth return destinations', () => {
  it('preserves public paths, queries and fragments on the configured frontend origin', () => {
    expect(validateOAuthReturnPath('/retket?year=2026#lappi', frontendUrl)).toBe(
      '/retket?year=2026#lappi'
    );
    expect(validateOAuthReturnPath('/', frontendUrl)).toBe('/');
  });

  it('accepts a public path at the maximum length', () => {
    const path = `/${'x'.repeat(2047)}`;
    expect(validateOAuthReturnPath(path, frontendUrl)).toBe(path);
  });

  it.each([
    undefined,
    '',
    `/${'x'.repeat(2048)}`,
    'https://evil.example/phish',
    '//evil.example/phish',
    '/retket/..//evil.example/phish',
    '/\\evil.example/phish',
    '/retket\n',
    '/auth',
    '/auth/logout',
    '/login',
    '/kirjaudu?error=auth_failed',
    '/control-panel',
    '/control-panel/visits',
    '/hallinta',
    '/hallinta/kaynnit',
    '/retket/../auth/logout'
  ])('rejects unsafe or non-public destination %j', (path) =>
    expect(validateOAuthReturnPath(path, frontendUrl)).toBeNull()
  );
});
