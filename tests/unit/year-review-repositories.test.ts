import { describe, expect, it } from 'vitest';

import {
  unpublishDateRangeReviewShare,
  unpublishDateRangeReviewShareByShareId,
  unpublishYearReviewShare,
  updatePublishedDateRangeReviewShareByShareId
} from '../../src/db/repositories.js';

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

  it('treats missing row counts as an unsuccessful date range unpublish', async () => {
    const database = {
      delete: () => ({
        where: async () => ({
          rowsAffected: undefined
        })
      })
    };

    await expect(unpublishDateRangeReviewShare(database as never, 'Summer Vacation')).resolves.toBe(
      false
    );
  });

  it('treats missing row counts as an unsuccessful date range share-id unpublish', async () => {
    const database = {
      delete: () => ({
        where: async () => ({
          rowsAffected: undefined
        })
      })
    };

    await expect(
      unpublishDateRangeReviewShareByShareId(
        database as never,
        '11111111-1111-4111-8111-111111111111'
      )
    ).resolves.toBe(false);
  });

  it('treats missing row counts as an unsuccessful date range share update', async () => {
    const database = {
      update: () => ({
        set: () => ({
          where: async () => ({
            rowsAffected: undefined
          })
        })
      })
    };

    await expect(
      updatePublishedDateRangeReviewShareByShareId(database as never, {
        endDate: '2026-06-30',
        generatedAt: '2026-06-30T10:00:00.000Z',
        name: 'Summer Vacation',
        publishedAt: '2026-06-30T10:00:00.000Z',
        shareId: '11111111-1111-4111-8111-111111111111',
        startDate: '2026-06-01',
        story: {
          cards: [],
          summary: {
            distinctParkCount: 0,
            imageCount: 0,
            newNationalParkCount: 0,
            revisitedParkCount: 0,
            tripCount: 0,
            visitCount: 0
          }
        },
        updatedAt: '2026-06-30T10:00:00.000Z'
      })
    ).resolves.toBeNull();
  });
});
