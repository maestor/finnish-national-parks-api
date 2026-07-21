import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  verifySessionToken
} from '../../src/http/session.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');

const adminPayload = {
  email: 'admin@example.com',
  name: 'Admin User',
  picture: 'https://example.com/photo.jpg',
  role: 'admin' as const,
  sub: 'google-user-id'
};

describe('session token', () => {
  it('issues tokens with admin role, issuer, and audience claims', async () => {
    const token = await createSessionToken(adminPayload, secret);
    const payload = await verifySessionToken(token, secret);

    expect(payload.role).toBe('admin');
    expect(payload.sub).toBe('google-user-id');
    expect(payload.email).toBe('admin@example.com');

    const [, payloadSegment] = token.split('.');
    const claims = JSON.parse(Buffer.from(payloadSegment ?? '', 'base64url').toString()) as {
      aud?: string;
      iss?: string;
      role?: string;
    };
    expect(claims.iss).toBe('reissuvihko-api');
    expect(claims.aud).toBe('reissuvihko-ui');
    expect(claims.role).toBe('admin');
    expect(SESSION_ISSUER).toBe('reissuvihko-api');
    expect(SESSION_AUDIENCE).toBe('reissuvihko-ui');
  });

  it('rejects tokens with a mismatched issuer', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ ...adminPayload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('someone-else')
      .setAudience(SESSION_AUDIENCE)
      .setExpirationTime('1 hour')
      .sign(secret);

    await expect(verifySessionToken(token, secret)).rejects.toThrow();
  });

  it('rejects tokens with a mismatched audience', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ ...adminPayload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(SESSION_ISSUER)
      .setAudience('someone-else')
      .setExpirationTime('1 hour')
      .sign(secret);

    await expect(verifySessionToken(token, secret)).rejects.toThrow();
  });
});
