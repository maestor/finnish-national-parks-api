import { describe, expect, it } from 'vitest';

import {
  buildYearReviewStory,
  createYearReviewSharePath,
  type YearReviewTimelineVisit,
  type YearReviewTrip
} from '../../src/year-review/story.js';

const createTrip = (overrides: Partial<YearReviewTrip> = {}): YearReviewTrip => {
  return {
    dateRange: {
      end: '2026-10-02',
      start: '2026-03-10'
    },
    description: null,
    id: 1,
    name: 'Alpha Trip',
    slug: 'alpha-trip',
    visitCount: 1,
    ...overrides
  };
};

const createVisit = (overrides: Partial<YearReviewTimelineVisit> = {}): YearReviewTimelineVisit => {
  return {
    createdAt: '2026-03-10T09:00:00.000Z',
    id: 1,
    imageCount: 0,
    park: {
      name: 'Akasmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto',
      typeLabel: 'Kansallispuisto'
    },
    route: null,
    trip: {
      id: 1,
      name: 'Alpha Trip',
      slug: 'alpha-trip'
    },
    tripStopOrder: null,
    visitedOn: '2026-03-10',
    ...overrides
  };
};

describe('year review story builder', () => {
  it('builds share paths with the public frontend route shape', () => {
    expect(createYearReviewSharePath('share-123')).toBe('/vuosikatsaus/jako/share-123');
  });

  it('returns a minimal empty-state story when the requested year has no visits', () => {
    const story = buildYearReviewStory({
      trips: [],
      visits: [
        createVisit({
          createdAt: '2025-01-10T09:00:00.000Z',
          id: 99,
          visitedOn: '2025-01-10'
        })
      ],
      year: 2026
    });
    const profileCard = story.cards.find((card) => card.kind === 'profile');
    const photoHighlightCard = story.cards.find((card) => card.kind === 'photo-highlight');
    const seasonalCard = story.cards.find((card) => card.kind === 'seasonal');

    expect(story.summary).toEqual({
      activeMonthCount: 0,
      distinctParkCount: 0,
      imageCount: 0,
      newParkCount: 0,
      revisitedParkCount: 0,
      visitCount: 0,
      visitsBySeason: {
        autumn: 0,
        spring: 0,
        summer: 0,
        winter: 0
      }
    });
    expect(story.cards).toEqual([
      {
        kind: 'intro',
        primaryStat: {
          key: 'visitCount',
          value: 0
        },
        year: 2026
      },
      {
        kind: 'photo-highlight',
        totalImageCount: 0,
        visit: null
      },
      {
        busiestMonth: null,
        busiestWeekday: null,
        kind: 'profile',
        mostVisitedPark: null,
        topRoute: null,
        topTypeLabel: null
      },
      {
        kind: 'seasonal',
        strongestSeason: null,
        visitsBySeason: {
          autumn: 0,
          spring: 0,
          summer: 0,
          winter: 0
        }
      },
      {
        highlights: ['0 visits', '0 distinct parks', '0 photos'],
        kind: 'summary'
      }
    ]);
    expect(profileCard).toBeDefined();
    expect(photoHighlightCard).toBeDefined();
    expect(seasonalCard).toBeDefined();
  });

  it('covers spring and autumn visits and breaks tied trip highlights by trip name', () => {
    const trips = [
      createTrip({
        id: 2,
        name: 'Beta Trip',
        slug: 'beta-trip'
      }),
      createTrip()
    ];
    const visits = [
      createVisit({
        createdAt: '2025-08-20T09:00:00.000Z',
        id: 10,
        park: {
          name: 'Akasmännyn kansallispuisto',
          slug: 'akasmannyn-kansallispuisto',
          typeLabel: 'Kansallispuisto'
        },
        trip: null,
        visitedOn: '2025-08-20'
      }),
      createVisit({
        id: 11,
        trip: {
          id: 2,
          name: 'Beta Trip',
          slug: 'beta-trip'
        },
        visitedOn: '2026-10-02'
      }),
      createVisit({
        id: 12,
        imageCount: 0,
        park: {
          name: 'Seitsemisen kansallispuisto',
          slug: 'seitsemisen-kansallispuisto',
          typeLabel: 'Kansallispuisto'
        },
        trip: {
          id: 1,
          name: 'Alpha Trip',
          slug: 'alpha-trip'
        },
        visitedOn: '2026-03-10'
      })
    ];

    const story = buildYearReviewStory({
      trips,
      visits,
      year: 2026
    });
    const tripHighlightCard = story.cards.find((card) => card.kind === 'trip-highlight');
    const seasonalCard = story.cards.find((card) => card.kind === 'seasonal');

    expect(story.summary.visitsBySeason).toEqual({
      autumn: 1,
      spring: 1,
      summer: 0,
      winter: 0
    });
    expect(story.summary.newParkCount).toBe(1);
    expect(story.summary.revisitedParkCount).toBe(1);
    expect(tripHighlightCard).toEqual({
      kind: 'trip-highlight',
      trip: {
        dateRange: {
          end: '2026-10-02',
          start: '2026-03-10'
        },
        id: 1,
        imageCount: 0,
        name: 'Alpha Trip',
        slug: 'alpha-trip',
        visitCount: 1
      }
    });
    expect(seasonalCard).toEqual({
      kind: 'seasonal',
      strongestSeason: 'autumn',
      visitsBySeason: {
        autumn: 1,
        spring: 1,
        summer: 0,
        winter: 0
      }
    });
  });

  it('orders same-day visits deterministically and ignores missing trip records', () => {
    const story = buildYearReviewStory({
      trips: [],
      visits: [
        createVisit({
          createdAt: '2026-06-10T10:00:00.000Z',
          id: 2,
          trip: {
            id: 999,
            name: 'Ghost Trip',
            slug: 'ghost-trip'
          },
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-10T10:00:00.000Z',
          id: 1,
          park: {
            name: 'Seitsemisen kansallispuisto',
            slug: 'seitsemisen-kansallispuisto',
            typeLabel: 'Kansallispuisto'
          },
          trip: {
            id: 999,
            name: 'Ghost Trip',
            slug: 'ghost-trip'
          },
          visitedOn: '2026-06-10'
        })
      ],
      year: 2026
    });

    expect(story.cards).toEqual(
      expect.arrayContaining([
        {
          kind: 'milestone',
          milestone: 'first-visit',
          visit: expect.objectContaining({
            id: 1
          })
        },
        {
          kind: 'milestone',
          milestone: 'last-visit',
          visit: expect.objectContaining({
            id: 2
          })
        }
      ])
    );
    expect(story.cards.some((card) => card.kind === 'trip-highlight')).toBe(false);
  });
});
