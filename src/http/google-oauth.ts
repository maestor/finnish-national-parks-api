import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createRemoteJWKSet, customFetch, type JWTPayload, jwtVerify } from 'jose';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;
const OAUTH_STATE_COOKIE = '__oauth_state';
const OAUTH_PKCE_COOKIE = '__oauth_pkce';
const OAUTH_INVITATION_COOKIE = '__oauth_invitation';
const ADMIN_INVITATION_COOKIE_MAX_AGE_SECONDS = 30 * 60;

type GoogleIdTokenPayload = JWTPayload & {
  aud: string;
  email: string;
  email_verified: boolean;
  exp: number;
  iss: string;
  name?: string;
  picture?: string;
  sub: string;
};

const defaultGoogleFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export const generateState = () => randomBytes(32).toString('base64url');
export const generateCodeVerifier = () => randomBytes(32).toString('base64url');
export const generateCodeChallenge = (verifier: string) => {
  return createHash('sha256').update(verifier).digest('base64url');
};

export const setOAuthStateCookie = (c: Context, state: string) => {
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const getOAuthStateCookie = (c: Context): string | undefined => {
  return getCookie(c, OAUTH_STATE_COOKIE);
};

export const clearOAuthStateCookie = (c: Context) => {
  deleteCookie(c, OAUTH_STATE_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const setPkceCookie = (c: Context, verifier: string) => {
  setCookie(c, OAUTH_PKCE_COOKIE, verifier, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const getPkceCookie = (c: Context): string | undefined => {
  return getCookie(c, OAUTH_PKCE_COOKIE);
};

export const clearPkceCookie = (c: Context) => {
  deleteCookie(c, OAUTH_PKCE_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const setAdminInvitationCookie = (c: Context, token: string) => {
  setCookie(c, OAUTH_INVITATION_COOKIE, token, {
    httpOnly: true,
    maxAge: ADMIN_INVITATION_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const getAdminInvitationCookie = (c: Context): string | undefined => {
  return getCookie(c, OAUTH_INVITATION_COOKIE);
};

export const clearAdminInvitationCookie = (c: Context) => {
  deleteCookie(c, OAUTH_INVITATION_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const buildGoogleAuthUrl = (params: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scope?: string;
  state: string;
}) => {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope ?? 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
};

export const exchangeCodeForTokens = async (params: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) => {
  const response = await defaultGoogleFetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as { id_token?: unknown };

  if (typeof data.id_token !== 'string' || data.id_token.length === 0) {
    throw new Error('Token exchange did not return an ID token');
  }

  return { id_token: data.id_token };
};

export const createGoogleIdTokenVerifier = (fetchFn: typeof fetch = defaultGoogleFetch) => {
  const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL, {
    [customFetch]: (url, options) => fetchFn(url, options),
    timeoutDuration: GOOGLE_REQUEST_TIMEOUT_MS
  });

  return async (idToken: string, clientId: string): Promise<GoogleIdTokenPayload> => {
    const { payload } = await jwtVerify<GoogleIdTokenPayload>(idToken, googleJwks, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
      requiredClaims: ['aud', 'email', 'email_verified', 'exp', 'iss', 'sub']
    });

    if (
      typeof payload.aud !== 'string' ||
      payload.aud !== clientId ||
      typeof payload.email !== 'string' ||
      payload.email.length === 0 ||
      payload.email_verified !== true ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      typeof payload.iss !== 'string' ||
      !GOOGLE_ISSUERS.includes(payload.iss) ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0
    ) {
      throw new Error('Invalid Google ID token claims');
    }

    return payload;
  };
};

export const verifyGoogleIdToken = createGoogleIdTokenVerifier();
