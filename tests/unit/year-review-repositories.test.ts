import { describe, expect, it } from 'vitest';

import { unpublishYearReviewShare } from '../../src/db/repositories.js';

describe('year review repository helpers', () => {
  it('treats missing row counts as an unsuccessful unpublish', async () => {
    const database = {
      delete: () => ({
        where: async () => ({
          rowsAffected: undefined
        })
      })
    };

    await expect(unpublishYearReviewShare(database as never, 2026)).resolves.toBe(false);
  });
});
