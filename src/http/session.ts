import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';

const SESSION_DURATION_SECONDS = 24 * 60 * 60;

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

export const createSessionToken = async (payload: SessionPayload, secret: Uint8Array) => {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS} seconds`)
    .sign(secret);
};

export const verifySessionToken = async (token: string, secret: Uint8Array) => {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
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
