import { describe, expect, it } from 'vitest';

import {
  MAX_DATE_RANGE_REVIEW_DAYS,
  validateDateRangeReviewRequest
} from '../../src/date-range-review/validation.js';

describe('date range review validation', () => {
  it('accepts a valid range within the supported length', () => {
    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-06-30',
        startDate: '2026-06-01'
      })
    ).toBeNull();
  });

  it('rejects malformed or impossible calendar dates', () => {
    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-06-30',
        startDate: '2026/06/01'
      })
    ).toBe('Start date and end date must be valid calendar dates.');

    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-06-30',
        startDate: '2026-13-01'
      })
    ).toBe('Start date and end date must be valid calendar dates.');

    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-06-30',
        startDate: '2026-02-30'
      })
    ).toBe('Start date and end date must be valid calendar dates.');
  });

  it('rejects reversed ranges', () => {
    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-06-01',
        startDate: '2026-06-30'
      })
    ).toBe('Start date must be on or before end date.');
  });

  it('rejects ranges longer than the supported maximum', () => {
    expect(
      validateDateRangeReviewRequest({
        endDate: '2026-07-10',
        startDate: '2026-01-01'
      })
    ).toBe(`Date range review supports at most ${MAX_DATE_RANGE_REVIEW_DAYS} days.`);
  });
});
