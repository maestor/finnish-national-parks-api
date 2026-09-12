import { exportJWK, generateKeyPair, type JWTHeaderParameters, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGoogleIdTokenVerifier, exchangeCodeForTokens } from '../../src/http/google-oauth.js';

const clientId = 'test-google-client-id';
const jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
type FetchInput = Parameters<typeof fetch>[0];

const createTestKeys = async () => {
  const keyPair = await generateKeyPair('RS256');
  const jwk = await exportJWK(keyPair.publicKey);

  return {
    jwk: { ...jwk, alg: 'RS256', kid: 'test-google-key', use: 'sig' },
    privateKey: keyPair.privateKey
  };
};

const createToken = async (
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  claims: Record<string, unknown>,
  protectedHeader: JWTHeaderParameters = { alg: 'RS256', kid: 'test-google-key' }
) => {
  return new SignJWT(claims).setProtectedHeader(protectedHeader).sign(privateKey);
};

const validClaims = () => ({
  aud: clientId,
  email: 'admin@example.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iss: 'https://accounts.google.com',
  name: 'Admin User',
  picture: 'https://example.com/photo.jpg',
  sub: 'google-user-id'
});

const createFetch = (jwk: Record<string, unknown>, status = 200) => {
  return async (url: FetchInput) => {
    expect(String(url)).toBe(jwksUrl);
    return new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'Content-Type': 'application/json' },
      status
    });
  };
};

describe('Google ID-token verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the OAuth token exchange a finite timeout signal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id_token: 'signed-token' }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await exchangeCodeForTokens({
      clientId,
      clientSecret: 'test-google-client-secret',
      code: 'authorization-code',
      codeVerifier: 'code-verifier',
      redirectUri: 'http://localhost:4300/auth/google/callback'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    );
  });

  it.each([{ id_token: undefined }, { id_token: '' }])(
    'rejects a successful token exchange without a usable ID token',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
      );

      await expect(
        exchangeCodeForTokens({
          clientId,
          clientSecret: 'test-google-client-secret',
          code: 'authorization-code',
          codeVerifier: 'code-verifier',
          redirectUri: 'http://localhost:4300/auth/google/callback'
        })
      ).rejects.toThrow('Token exchange did not return an ID token');
    }
  );

  it('verifies a signed token against the fixed Google JWKS endpoint and caches the key', async () => {
    const keys = await createTestKeys();
    let jwksFetches = 0;
    const fetchJwks = async (url: FetchInput) => {
      jwksFetches += 1;
      return createFetch(keys.jwk)(url);
    };
    const verify = createGoogleIdTokenVerifier(fetchJwks);
    const token = await createToken(keys.privateKey, validClaims());

    await expect(verify(token, clientId)).resolves.toMatchObject({
      email: 'admin@example.com',
      email_verified: true,
      sub: 'google-user-id'
    });
    await expect(verify(token, clientId)).resolves.toMatchObject({ sub: 'google-user-id' });
    expect(jwksFetches).toBe(1);
  });

  it('does not follow a token-controlled key URL', async () => {
    const keys = await createTestKeys();
    const fetchJwks = createFetch(keys.jwk);
    const verify = createGoogleIdTokenVerifier(fetchJwks);
    const token = await createToken(keys.privateKey, validClaims(), {
      alg: 'RS256',
      jku: 'https://attacker.example/keys.json',
      kid: 'test-google-key'
    });

    await expect(verify(token, clientId)).resolves.toMatchObject({ sub: 'google-user-id' });
  });

  it('rejects a token with a wrong signature or algorithm', async () => {
    const keys = await createTestKeys();
    const otherKeys = await createTestKeys();
    const verify = createGoogleIdTokenVerifier(createFetch(keys.jwk));

    const wrongSignature = await createToken(otherKeys.privateKey, validClaims());
    await expect(verify(wrongSignature, clientId)).rejects.toThrow();

    const wrongAlgorithm = await new SignJWT(validClaims())
      .setProtectedHeader({ alg: 'HS256', kid: 'test-google-key' })
      .sign(new TextEncoder().encode('not-an-rsa-key'));
    await expect(verify(wrongAlgorithm, clientId)).rejects.toThrow();
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'another-client-id' }],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['missing expiry', { exp: undefined }],
    ['unverified email', { email_verified: false }],
    ['missing subject', { sub: undefined }]
  ])('rejects a token with an invalid or missing %s claim', async (_claim, override) => {
    const keys = await createTestKeys();
    const verify = createGoogleIdTokenVerifier(createFetch(keys.jwk));
    const claims: Record<string, unknown> = { ...validClaims(), ...override };

    if (claims.exp === undefined) {
      delete claims.exp;
    }
    if (claims.sub === undefined) {
      delete claims.sub;
    }

    const token = await createToken(keys.privateKey, claims);
    await expect(verify(token, clientId)).rejects.toThrow();
  });

  it('fails closed when the Google signing-key endpoint is unavailable', async () => {
    const keys = await createTestKeys();
    const verify = createGoogleIdTokenVerifier(createFetch(keys.jwk, 503));
    const token = await createToken(keys.privateKey, validClaims());

    await expect(verify(token, clientId)).rejects.toThrow();
  });
});
