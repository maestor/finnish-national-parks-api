import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const OAUTH_STATE_COOKIE = '__oauth_state';
const OAUTH_PKCE_COOKIE = '__oauth_pkce';

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
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as { id_token: string };
  return data;
};

export const verifyGoogleIdToken = async (idToken: string, clientId: string) => {
  const response = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${idToken}`);

  if (!response.ok) {
    throw new Error('Invalid ID token');
  }

  const payload = (await response.json()) as {
    aud: string;
    email: string;
    exp: string;
    iss: string;
    name?: string;
    picture?: string;
    sub: string;
  };

  if (payload.aud !== clientId) {
    throw new Error('Invalid audience');
  }

  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('Invalid issuer');
  }

  const now = Math.floor(Date.now() / 1000);

  if (Number(payload.exp) < now) {
    throw new Error('Token expired');
  }

  return payload;
};
