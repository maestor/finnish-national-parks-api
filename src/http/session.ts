import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';

const SESSION_DURATION_SECONDS = 24 * 60 * 60;

export const SESSION_ISSUER = 'reissuvihko-api';
export const SESSION_AUDIENCE = 'reissuvihko-ui';

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  role: 'admin';
};

export const createSessionToken = async (payload: SessionPayload, secret: Uint8Array) => {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(`${SESSION_DURATION_SECONDS} seconds`)
    .sign(secret);
};

export const verifySessionToken = async (token: string, secret: Uint8Array) => {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    audience: SESSION_AUDIENCE,
    issuer: SESSION_ISSUER
  });
  return payload as unknown as SessionPayload;
};

export const setSessionCookie = (c: Context, token: string, cookieName: string) => {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const getSessionCookie = (c: Context, cookieName: string): string | undefined => {
  return getCookie(c, cookieName);
};

export const clearSessionCookie = (c: Context, cookieName: string) => {
  deleteCookie(c, cookieName, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};
