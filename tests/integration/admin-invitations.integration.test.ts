import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import * as repositories from '../../src/db/repositories.js';
import { adminInvitations, admins } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { createTestDatabase } from '../helpers/test-db.js';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};
const testGoogleKeysPromise = (async () => {
  const keyPair = await generateKeyPair('RS256');
  const jwk = await exportJWK(keyPair.publicKey);

  return {
    jwk: { ...jwk, alg: 'RS256', kid: 'test-google-key', use: 'sig' },
    privateKey: keyPair.privateKey
  };
})();

const createTestGoogleIdToken = async (payload: object) => {
  const { privateKey } = await testGoogleKeysPromise;

  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-google-key' })
    .sign(privateKey);
};

const mockGoogleFetch = (claims: object) => {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      const { jwk } = await testGoogleKeysPromise;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }

    if (url === 'https://oauth2.googleapis.com/token') {
      const idToken = await createTestGoogleIdToken(claims);
      return new Response(JSON.stringify({ id_token: idToken }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }

    return new Response('Not found', { status: 404 });
  });
};

const extractCookies = (response: Response): Record<string, string> => {
  const cookies: Record<string, string> = {};

  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [nameValue] = cookie.split(';');
    const [name, value] = nameValue?.split('=') ?? [];

    if (name && value !== undefined) {
      cookies[name.trim()] = value.trim();
    }
  }

  return cookies;
};

const createAdminSessionCookie = async (sub = 'existing-admin-google-sub') => {
  const token = await createSessionToken(
    {
      email: 'existing-admin@example.com',
      name: 'Existing admin',
      picture: '',
      role: 'admin',
      sub
    },
    new TextEncoder().encode(authConfig.jwtSecret)
  );

  return `${authConfig.cookieName}=${token}`;
};

describe('admin invitations', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'existing-admin@example.com',
      googleSub: 'existing-admin-google-sub',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
    vi.restoreAllMocks();
  });

  it('creates a short-lived invitation and provisions a new admin after Google acceptance', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const createResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'New.Admin@Example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });

    expect(createResponse.status).toBe(201);
    const invitation = (await createResponse.json()) as {
      email: string;
      expiresAt: string;
      invitationUrl: string;
    };
    expect(invitation.email).toBe('new.admin@example.com');
    expect(invitation.invitationUrl).toMatch(/^http:\/\/localhost:4300\/auth\/google\?invite=/);
    expect(new Date(invitation.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const storedInvitation = await testDatabase.database
      .select()
      .from(adminInvitations)
      .where(eq(adminInvitations.email, 'new.admin@example.com'))
      .limit(1);
    expect(storedInvitation).toHaveLength(1);
    expect(storedInvitation[0]?.tokenHash).not.toBe(
      new URL(invitation.invitationUrl).searchParams.get('invite')
    );

    const inviteStartResponse = await app.request(
      `/auth/google?invite=${encodeURIComponent(new URL(invitation.invitationUrl).searchParams.get('invite') ?? '')}`
    );
    expect(inviteStartResponse.status).toBe(302);

    const oauthCookies = extractCookies(inviteStartResponse);
    expect(oauthCookies.__oauth_invitation).toBeDefined();

    global.fetch = mockGoogleFetch({
      aud: authConfig.googleClientId,
      email: 'new.admin@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      sub: 'new-admin-google-sub'
    }) as typeof fetch;

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${oauthCookies.__oauth_state}`,
      {
        headers: {
          cookie: Object.entries(oauthCookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe('http://localhost:4300/control-panel');
    expect(extractCookies(callbackResponse).__session).toBeDefined();

    const provisionedAdmin = await testDatabase.database
      .select()
      .from(admins)
      .where(
        and(eq(admins.email, 'new.admin@example.com'), eq(admins.googleSub, 'new-admin-google-sub'))
      )
      .limit(1);
    expect(provisionedAdmin).toHaveLength(1);

    const consumedInvitation = await testDatabase.database
      .select()
      .from(adminInvitations)
      .where(eq(adminInvitations.email, 'new.admin@example.com'))
      .limit(1);
    expect(consumedInvitation[0]?.usedAt).not.toBeNull();
  });

  it('binds an existing email-only admin and rejects a second use', async () => {
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'legacy-admin@example.com',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const createResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'legacy-admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });
    const invitation = (await createResponse.json()) as { invitationUrl: string };
    const token = new URL(invitation.invitationUrl).searchParams.get('invite');

    const inviteStartResponse = await app.request(`/auth/google?invite=${token}`);
    const oauthCookies = extractCookies(inviteStartResponse);
    global.fetch = mockGoogleFetch({
      aud: authConfig.googleClientId,
      email: 'legacy-admin@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      sub: 'legacy-admin-google-sub'
    }) as typeof fetch;

    const callbackPath = `/auth/google/callback?code=auth-code&state=${oauthCookies.__oauth_state}`;
    const callbackHeaders = {
      cookie: Object.entries(oauthCookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ')
    };
    const callbackResponse = await app.request(callbackPath, { headers: callbackHeaders });

    expect(callbackResponse.headers.get('location')).toBe('http://localhost:4300/control-panel');

    const secondStartResponse = await app.request(`/auth/google?invite=${token}`);
    expect(secondStartResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=invitation_invalid'
    );
    const legacyAdmin = await testDatabase.database
      .select()
      .from(admins)
      .where(eq(admins.email, 'legacy-admin@example.com'))
      .limit(1);
    expect(legacyAdmin[0]?.googleSub).toBe('legacy-admin-google-sub');
  });

  it('rejects an invitation when a different verified Google email accepts it', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const createResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'invited-admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });
    const invitation = (await createResponse.json()) as { invitationUrl: string };
    const token = new URL(invitation.invitationUrl).searchParams.get('invite');
    const inviteStartResponse = await app.request(`/auth/google?invite=${token}`);
    const oauthCookies = extractCookies(inviteStartResponse);

    global.fetch = mockGoogleFetch({
      aud: authConfig.googleClientId,
      email: 'another-google-user@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      sub: 'another-google-user-sub'
    }) as typeof fetch;

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${oauthCookies.__oauth_state}`,
      {
        headers: {
          cookie: Object.entries(oauthCookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }
      }
    );

    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=invitation_failed'
    );
    const invitedAdmin = await testDatabase.database
      .select()
      .from(admins)
      .where(eq(admins.email, 'invited-admin@example.com'))
      .limit(1);
    expect(invitedAdmin).toHaveLength(0);
  });

  it('redirects to invitation_failed when invited OAuth exchange fails', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const createResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'failed-invitation@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });
    const invitation = (await createResponse.json()) as { invitationUrl: string };
    const token = new URL(invitation.invitationUrl).searchParams.get('invite');
    const inviteStartResponse = await app.request(`/auth/google?invite=${token}`);
    const oauthCookies = extractCookies(inviteStartResponse);
    global.fetch = vi.fn().mockRejectedValue(new Error('token exchange failed')) as typeof fetch;

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${oauthCookies.__oauth_state}`,
      {
        headers: {
          cookie: Object.entries(oauthCookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }
      }
    );

    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=invitation_failed'
    );
  });

  it('rejects an invitation for an already enrolled email', async () => {
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'enrolled-admin@example.com',
      googleSub: 'enrolled-admin-google-sub',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'enrolled-admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });

    expect(response.status).toBe(409);
  });

  it('rejects unauthenticated and unprovisioned invitation requests', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });

    const unauthenticatedResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'new.admin@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    });
    expect(unauthenticatedResponse.status).toBe(401);

    const unprovisionedSession = await createAdminSessionCookie('missing-admin-google-sub');
    const unprovisionedResponse = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'new.admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: unprovisionedSession
      },
      method: 'POST'
    });
    expect(unprovisionedResponse.status).toBe(403);
  });

  it('re-throws unexpected invitation creation errors', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const invitationSpy = vi
      .spyOn(repositories, 'createAdminInvitation')
      .mockRejectedValueOnce(new Error('unexpected invitation failure'));

    const response = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'new.admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie()
      },
      method: 'POST'
    });

    expect(response.status).toBe(500);

    invitationSpy.mockRestore();
  });

  it('rejects malformed invitation tokens before database access', async () => {
    const { acceptAdminInvitation, isAdminInvitationUsable } = repositories;

    await expect(isAdminInvitationUsable(testDatabase.database, '')).resolves.toBe(false);
    await expect(isAdminInvitationUsable(testDatabase.database, 'a'.repeat(257))).resolves.toBe(
      false
    );

    await expect(
      acceptAdminInvitation(testDatabase.database, {
        email: 'new.admin@example.com',
        googleSub: 'new-admin-google-sub',
        token: ''
      })
    ).resolves.toBe(false);

    await expect(
      acceptAdminInvitation(testDatabase.database, {
        email: 'new.admin@example.com',
        googleSub: 'new-admin-google-sub',
        token: 'a'.repeat(257)
      })
    ).resolves.toBe(false);
  });

  it('returns 503 when invitations are requested without OAuth configuration', async () => {
    const app = createApp({ database: testDatabase.database });
    const response = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'new.admin@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    });

    expect(response.status).toBe(503);
  });

  it('rejects invitations when the Google subject belongs to another admin', async () => {
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'other-admin@example.com',
      googleSub: 'owned-by-other-admin',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'email-only-admin@example.com',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const invitation = await repositories.createAdminInvitation(testDatabase.database, {
      createdByAdminId: 1,
      email: 'email-only-admin@example.com'
    });

    await expect(
      repositories.acceptAdminInvitation(testDatabase.database, {
        email: 'email-only-admin@example.com',
        googleSub: 'owned-by-other-admin',
        token: invitation.token
      })
    ).resolves.toBe(false);
  });

  it('rejects invitations that try to replace an enrolled Google subject', async () => {
    const token = 'enrolled-admin-invitation-token';
    await testDatabase.database.insert(adminInvitations).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      createdByAdminId: 1,
      email: 'existing-admin@example.com',
      expiresAt: '2099-05-01T10:00:00.000Z',
      tokenHash: createHash('sha256').update(token).digest('hex')
    });

    await expect(
      repositories.acceptAdminInvitation(testDatabase.database, {
        email: 'existing-admin@example.com',
        googleSub: 'different-google-sub',
        token
      })
    ).resolves.toBe(false);
  });
});
