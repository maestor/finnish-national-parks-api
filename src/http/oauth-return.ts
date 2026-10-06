import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const OAUTH_RETURN_COOKIE = '__oauth_return';
const NON_PUBLIC_PATHS = ['/auth', '/login', '/kirjaudu', '/control-panel', '/hallinta'];

export const validateOAuthReturnPath = (
  path: string | undefined,
  frontendUrl: string
): string | null => {
  if (!path || path.length > 2048 || !/^\/(?!\/)/.test(path) || /[\\\p{Cc}]/u.test(path)) {
    return null;
  }
  const url = new URL(path, frontendUrl);
  if (
    url.pathname.startsWith('//') ||
    NON_PUBLIC_PATHS.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))
  ) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

export const clearOAuthReturnCookie = (context: Context) =>
  deleteCookie(context, OAUTH_RETURN_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });

export const setOAuthReturnCookie = (context: Context, path: string | null) => {
  if (!path) {
    clearOAuthReturnCookie(context);
    return;
  }
  setCookie(context, OAUTH_RETURN_COOKIE, path, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

export const readOAuthReturnPath = (context: Context, frontendUrl: string) =>
  validateOAuthReturnPath(getCookie(context, OAUTH_RETURN_COOKIE), frontendUrl);
