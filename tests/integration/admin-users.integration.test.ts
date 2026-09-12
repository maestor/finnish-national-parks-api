import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import * as repositories from '../../src/db/repositories.js';
import { createAdminInvitation } from '../../src/db/repositories.js';
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

const createAdminSessionCookie = async (sub: string) => {
  const token = await createSessionToken(
    {
      email: `${sub}@example.com`,
      name: sub,
      picture: '',
      role: 'admin',
      sub
    },
    new TextEncoder().encode(authConfig.jwtSecret)
  );

  return `${authConfig.cookieName}=${token}`;
};

describe('admin users', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    await testDatabase.database.insert(admins).values([
      {
        createdAt: '2026-05-01T10:00:00.000Z',
        email: 'super@example.com',
        googleSub: 'super-admin-sub',
        superAdmin: true,
        updatedAt: '2026-05-01T10:00:00.000Z'
      },
      {
        createdAt: '2026-05-01T10:00:00.000Z',
        email: 'normal@example.com',
        googleSub: 'normal-admin-sub',
        updatedAt: '2026-05-01T10:00:00.000Z'
      }
    ]);
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('lists all admins for a super admin and hides the list from normal admins', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });

    const response = await app.request('/api/admin/admins', {
      headers: { cookie: await createAdminSessionCookie('super-admin-sub') }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      admins: [
        expect.objectContaining({
          email: 'normal@example.com',
          id: 2,
          isEnrolled: true,
          isSuperAdmin: false
        }),
        expect.objectContaining({
          email: 'super@example.com',
          id: 1,
          isEnrolled: true,
          isSuperAdmin: true
        })
      ]
    });

    const normalResponse = await app.request('/api/admin/admins', {
      headers: { cookie: await createAdminSessionCookie('normal-admin-sub') }
    });
    expect(normalResponse.status).toBe(403);
  });

  it('upgrades and reduces another admin, but rejects self-modification', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const headers = {
      'Content-Type': 'application/json',
      cookie: await createAdminSessionCookie('super-admin-sub')
    };

    const upgradeResponse = await app.request('/api/admin/admins/2', {
      body: JSON.stringify({ isSuperAdmin: true }),
      headers,
      method: 'PATCH'
    });
    expect(upgradeResponse.status).toBe(200);
    await expect(upgradeResponse.json()).resolves.toMatchObject({
      email: 'normal@example.com',
      isSuperAdmin: true
    });

    const reduceResponse = await app.request('/api/admin/admins/2', {
      body: JSON.stringify({ isSuperAdmin: false }),
      headers,
      method: 'PATCH'
    });
    expect(reduceResponse.status).toBe(200);
    await expect(reduceResponse.json()).resolves.toMatchObject({ isSuperAdmin: false });

    const selfResponse = await app.request('/api/admin/admins/1', {
      body: JSON.stringify({ isSuperAdmin: false }),
      headers,
      method: 'PATCH'
    });
    expect(selfResponse.status).toBe(409);
    await expect(selfResponse.json()).resolves.toMatchObject({
      error: 'A super admin cannot modify their own account.'
    });

    const missingResponse = await app.request('/api/admin/admins/99', {
      body: JSON.stringify({ isSuperAdmin: true }),
      headers,
      method: 'PATCH'
    });
    expect(missingResponse.status).toBe(404);
  });

  it('removes another admin and cannot remove the current super admin', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    await createAdminInvitation(testDatabase.database, {
      createdByAdminId: 2,
      email: 'created-by-removed-admin@example.com'
    });

    const response = await app.request('/api/admin/admins/2', {
      headers: { cookie: await createAdminSessionCookie('super-admin-sub') },
      method: 'DELETE'
    });
    expect(response.status).toBe(204);

    const removedAdmin = await testDatabase.database.select().from(admins).where(eq(admins.id, 2));
    expect(removedAdmin).toHaveLength(0);

    const removedAdminInvitations = await testDatabase.database
      .select()
      .from(adminInvitations)
      .where(eq(adminInvitations.createdByAdminId, 2));
    expect(removedAdminInvitations).toHaveLength(0);

    const selfResponse = await app.request('/api/admin/admins/1', {
      headers: { cookie: await createAdminSessionCookie('super-admin-sub') },
      method: 'DELETE'
    });
    expect(selfResponse.status).toBe(409);

    const missingResponse = await app.request('/api/admin/admins/2', {
      headers: { cookie: await createAdminSessionCookie('super-admin-sub') },
      method: 'DELETE'
    });
    expect(missingResponse.status).toBe(404);
  });

  it('requires an authenticated super admin', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });

    const unauthenticatedResponse = await app.request('/api/admin/admins');
    expect(unauthenticatedResponse.status).toBe(401);

    const unconfiguredResponse = await createApp({ database: testDatabase.database }).request(
      '/api/admin/admins'
    );
    expect(unconfiguredResponse.status).toBe(503);
  });

  it('exposes the current super-admin status through auth/me', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });

    const superAdminResponse = await app.request('/auth/me', {
      headers: { cookie: await createAdminSessionCookie('super-admin-sub') }
    });
    expect(superAdminResponse.status).toBe(200);
    await expect(superAdminResponse.json()).resolves.toMatchObject({
      id: 'super-admin-sub',
      isSuperAdmin: true
    });

    const normalAdminResponse = await app.request('/auth/me', {
      headers: { cookie: await createAdminSessionCookie('normal-admin-sub') }
    });
    expect(normalAdminResponse.status).toBe(200);
    await expect(normalAdminResponse.json()).resolves.toMatchObject({
      id: 'normal-admin-sub',
      isSuperAdmin: false
    });
  });

  it('does not allow a normal admin to create invitations', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/api/admin/invitations', {
      body: JSON.stringify({ email: 'new.admin@example.com' }),
      headers: {
        'Content-Type': 'application/json',
        cookie: await createAdminSessionCookie('normal-admin-sub')
      },
      method: 'POST'
    });

    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated delete requests', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/api/admin/admins/2', { method: 'DELETE' });

    expect(response.status).toBe(401);

    const updateResponse = await app.request('/api/admin/admins/2', {
      body: JSON.stringify({ isSuperAdmin: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH'
    });
    expect(updateResponse.status).toBe(401);
  });

  it('returns server errors from admin role changes and removals', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const headers = {
      'Content-Type': 'application/json',
      cookie: await createAdminSessionCookie('super-admin-sub')
    };
    const updateSpy = vi
      .spyOn(repositories, 'updateAdminUser')
      .mockRejectedValueOnce(new Error('unexpected update failure'));
    const updateResponse = await app.request('/api/admin/admins/2', {
      body: JSON.stringify({ isSuperAdmin: true }),
      headers,
      method: 'PATCH'
    });
    expect(updateResponse.status).toBe(500);
    updateSpy.mockRestore();

    const removeSpy = vi
      .spyOn(repositories, 'removeAdminUser')
      .mockRejectedValueOnce(new Error('unexpected removal failure'));
    const removeResponse = await app.request('/api/admin/admins/2', {
      headers,
      method: 'DELETE'
    });
    expect(removeResponse.status).toBe(500);
    removeSpy.mockRestore();
  });
});
