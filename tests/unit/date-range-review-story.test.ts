import { describe, expect, it } from 'vitest';

import {
  buildDateRangeReviewStory,
  createDateRangeReviewSharePath,
  type DateRangeReviewTimelineVisit,
  type DateRangeReviewTrip
} from '../../src/date-range-review/story.js';

const createTrip = (overrides: Partial<DateRangeReviewTrip> = {}): DateRangeReviewTrip => {
  return {
    dateRange: {
      end: '2026-07-03',
      start: '2026-06-10'
    },
    description: null,
    id: 1,
    name: 'Summer Escape',
    slug: 'summer-escape',
    visitCount: 1,
    ...overrides
  };
};

const createVisit = (
  overrides: Partial<DateRangeReviewTimelineVisit> = {}
): DateRangeReviewTimelineVisit => {
  return {
    createdAt: '2026-06-10T09:00:00.000Z',
    id: 1,
    imageCount: 0,
    park: {
      name: 'Aulangon kansallispuisto',
      slug: 'aulangon-kansallispuisto',
      typeLabel: 'Kansallispuisto',
      typeSlug: 'national-park'
    },
    route: null,
    trip: {
      id: 1,
      name: 'Summer Escape',
      slug: 'summer-escape'
    },
    tripStopOrder: null,
    visitedOn: '2026-06-10',
    ...overrides
  };
};

describe('date range review story builder', () => {
  it('builds share paths with the public frontend route shape', () => {
    expect(createDateRangeReviewSharePath('share-123')).toBe('/ajanjaksokatsaus/jako/share-123');
  });

  it('returns only intro and empty photo highlight cards when the range has no visits', () => {
    const story = buildDateRangeReviewStory({
      endDate: '2026-06-30',
      name: 'Quiet Month',
      overviewSlug: 'quiet-month',
      trips: [],
      visits: [
        createVisit({
          createdAt: '2026-05-20T09:00:00.000Z',
          id: 90,
          visitedOn: '2026-05-20'
        })
      ],
      startDate: '2026-06-01'
    });

    expect(story.summary).toEqual({
      distinctParkCount: 0,
      imageCount: 0,
      newNationalParkCount: 0,
      revisitedParkCount: 0,
      tripCount: 0,
      visitCount: 0
    });
    expect(story.cards).toEqual([
      {
        dateRange: {
          endDate: '2026-06-30',
          startDate: '2026-06-01'
        },
        kind: 'intro',
        name: 'Quiet Month',
        primaryStat: {
          key: 'visitCount',
          value: 0
        },
        tripCount: 0
      },
      {
        featuredImage: null,
        kind: 'photo-highlight',
        totalImageCount: 0,
        visit: null
      }
    ]);
  });

  it('builds the requested card order for a named overview range', () => {
    const trips = [
      createTrip({
        id: 1,
        name: 'Summer Escape',
        slug: 'summer-escape'
      }),
      createTrip({
        dateRange: {
          end: '2026-07-20',
          start: '2026-07-01'
        },
        id: 2,
        name: 'July Sprint',
        slug: 'july-sprint'
      })
    ];
    const story = buildDateRangeReviewStory({
      endDate: '2026-07-15',
      name: 'Summer Vacation',
      overviewSlug: 'summer-vacation',
      trips,
      visits: [
        createVisit({
          createdAt: '2026-06-05T09:00:00.000Z',
          id: 99,
          imageCount: 1,
          visitedOn: '2026-06-05'
        }),
        createVisit({
          id: 1,
          imageCount: 1,
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-12T09:00:00.000Z',
          id: 2,
          imageCount: 2,
          park: {
            name: 'Seitsemisen kansallispuisto',
            slug: 'seitsemisen-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 1,
            name: 'Summer Escape',
            slug: 'summer-escape'
          },
          visitedOn: '2026-06-12'
        }),
        createVisit({
          createdAt: '2026-06-20T09:00:00.000Z',
          id: 3,
          imageCount: 0,
          park: {
            name: 'Evon retkeilyalue',
            slug: 'evon-retkeilyalue',
            typeLabel: 'Retkeilyalue',
            typeSlug: 'hiking-area'
          },
          trip: null,
          visitedOn: '2026-06-20'
        }),
        createVisit({
          createdAt: '2026-07-01T09:00:00.000Z',
          id: 4,
          imageCount: 1,
          park: {
            name: 'Sallan kansallispuisto',
            slug: 'sallan-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 2,
            name: 'July Sprint',
            slug: 'july-sprint'
          },
          visitedOn: '2026-07-01'
        })
      ],
      startDate: '2026-06-10'
    });

    expect(story.summary).toEqual({
      distinctParkCount: 4,
      imageCount: 4,
      newNationalParkCount: 2,
      revisitedParkCount: 1,
      tripCount: 2,
      visitCount: 4
    });
    expect(story.cards.map((card) => card.kind)).toEqual([
      'intro',
      'photo-highlight',
      'new-parks',
      'revisited-parks',
      'trip-summary',
      'trip-summary'
    ]);
    expect(story.cards[0]).toEqual({
      dateRange: {
        endDate: '2026-07-15',
        startDate: '2026-06-10'
      },
      kind: 'intro',
      name: 'Summer Vacation',
      primaryStat: {
        key: 'visitCount',
        value: 4
      },
      tripCount: 2
    });
    expect(story.cards[2]).toEqual({
      kind: 'new-parks',
      parks: [
        {
          featuredImage: null,
          park: {
            name: 'Seitsemisen kansallispuisto',
            slug: 'seitsemisen-kansallispuisto'
          },
          visitedOn: '2026-06-12'
        },
        {
          featuredImage: null,
          park: {
            name: 'Sallan kansallispuisto',
            slug: 'sallan-kansallispuisto'
          },
          visitedOn: '2026-07-01'
        }
      ]
    });
    expect(story.cards[3]).toEqual({
      kind: 'revisited-parks',
      parks: [
        {
          featuredImage: null,
          park: {
            name: 'Aulangon kansallispuisto',
            slug: 'aulangon-kansallispuisto'
          },
          previousVisitDate: '2026-06-05',
          revisitCount: 1,
          visitedOn: '2026-06-10'
        }
      ]
    });
    expect(story.cards[4]).toEqual({
      featuredImage: null,
      kind: 'trip-summary',
      trip: {
        dateRange: {
          end: '2026-06-12',
          start: '2026-06-10'
        },
        id: 1,
        imageCount: 3,
        name: 'Summer Escape',
        slug: 'summer-escape',
        visitCount: 2
      }
    });
    expect(story.cards[5]).toEqual({
      featuredImage: null,
      kind: 'trip-summary',
      trip: {
        dateRange: {
          end: '2026-07-01',
          start: '2026-07-01'
        },
        id: 2,
        imageCount: 1,
        name: 'July Sprint',
        slug: 'july-sprint',
        visitCount: 1
      }
    });
  });

  it('ignores unmatched trip references and repeated revisit/new-park moments', () => {
    const story = buildDateRangeReviewStory({
      endDate: '2026-06-30',
      name: 'Edge Cases',
      overviewSlug: 'edge-cases',
      trips: [],
      visits: [
        createVisit({
          createdAt: '2026-05-15T09:00:00.000Z',
          id: 80,
          imageCount: 0,
          visitedOn: '2026-05-15'
        }),
        createVisit({
          id: 1,
          imageCount: 0,
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-11T09:00:00.000Z',
          id: 2,
          imageCount: 0,
          trip: {
            id: 999,
            name: 'Missing Trip',
            slug: 'missing-trip'
          },
          visitedOn: '2026-06-11'
        }),
        createVisit({
          createdAt: '2026-06-12T09:00:00.000Z',
          id: 3,
          imageCount: 0,
          park: {
            name: 'Salamanperan kansallispuisto',
            slug: 'salamanperan-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: null,
          visitedOn: '2026-06-12'
        }),
        createVisit({
          createdAt: '2026-06-13T09:00:00.000Z',
          id: 4,
          imageCount: 0,
          park: {
            name: 'Salamanperan kansallispuisto',
            slug: 'salamanperan-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: null,
          visitedOn: '2026-06-13'
        })
      ],
      startDate: '2026-06-01'
    });

    expect(story.summary.tripCount).toBe(0);
    expect(story.cards.find((card) => card.kind === 'trip-summary')).toBeUndefined();
    expect(story.cards.find((card) => card.kind === 'new-parks')).toEqual({
      kind: 'new-parks',
      parks: [
        {
          featuredImage: null,
          park: {
            name: 'Salamanperan kansallispuisto',
            slug: 'salamanperan-kansallispuisto'
          },
          visitedOn: '2026-06-12'
        }
      ]
    });
    expect(story.cards.find((card) => card.kind === 'revisited-parks')).toEqual({
      kind: 'revisited-parks',
      parks: [
        {
          featuredImage: null,
          park: {
            name: 'Aulangon kansallispuisto',
            slug: 'aulangon-kansallispuisto'
          },
          previousVisitDate: '2026-05-15',
          revisitCount: 2,
          visitedOn: '2026-06-10'
        }
      ]
    });
  });

  it('uses narrative tie-breakers for revisits and trip cards when dates collide', () => {
    const story = buildDateRangeReviewStory({
      endDate: '2026-06-30',
      name: 'Tie Breakers',
      overviewSlug: 'tie-breakers',
      trips: [
        createTrip({
          id: 1,
          name: 'Beta Escape',
          slug: 'beta-escape'
        }),
        createTrip({
          id: 2,
          name: 'Alpha Escape',
          slug: 'alpha-escape'
        })
      ],
      visitImagesByVisitId: new Map([
        [
          31,
          [
            {
              alt: null,
              fullHeight: 1200,
              fullKey: 'beta-early-full',
              fullWidth: 1600,
              thumbHeight: 600,
              thumbKey: 'beta-early-thumb',
              thumbWidth: 800
            }
          ]
        ],
        [
          39,
          [
            {
              alt: null,
              fullHeight: 1200,
              fullKey: 'alpha-low-id-full',
              fullWidth: 1600,
              thumbHeight: 600,
              thumbKey: 'alpha-low-id-thumb',
              thumbWidth: 800
            }
          ]
        ]
      ]),
      visits: [
        createVisit({
          createdAt: '2026-05-10T09:00:00.000Z',
          id: 80,
          trip: null,
          visitedOn: '2026-05-10'
        }),
        createVisit({
          createdAt: '2026-05-20T09:00:00.000Z',
          id: 81,
          trip: null,
          visitedOn: '2026-05-20'
        }),
        createVisit({
          createdAt: '2026-05-15T09:00:00.000Z',
          id: 82,
          trip: null,
          visitedOn: '2026-05-15'
        }),
        createVisit({
          createdAt: '2026-06-10T07:00:00.000Z',
          id: 20,
          trip: null,
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-10T09:00:00.000Z',
          id: 30,
          imageCount: 1,
          park: {
            name: 'Helvetinjarven kansallispuisto',
            slug: 'helvetinjarven-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 1,
            name: 'Beta Escape',
            slug: 'beta-escape'
          },
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-10T08:00:00.000Z',
          id: 31,
          imageCount: 1,
          park: {
            name: 'Kolin kansallispuisto',
            slug: 'kolin-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 1,
            name: 'Beta Escape',
            slug: 'beta-escape'
          },
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-10T09:00:00.000Z',
          id: 40,
          imageCount: 1,
          park: {
            name: 'Patvinsuon kansallispuisto',
            slug: 'patvinsuon-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 2,
            name: 'Alpha Escape',
            slug: 'alpha-escape'
          },
          visitedOn: '2026-06-10'
        }),
        createVisit({
          createdAt: '2026-06-10T09:00:00.000Z',
          id: 39,
          imageCount: 1,
          park: {
            name: 'Repoveden kansallispuisto',
            slug: 'repoveden-kansallispuisto',
            typeLabel: 'Kansallispuisto',
            typeSlug: 'national-park'
          },
          trip: {
            id: 2,
            name: 'Alpha Escape',
            slug: 'alpha-escape'
          },
          visitedOn: '2026-06-10'
        })
      ],
      startDate: '2026-06-01'
    });

    expect(story.cards.find((card) => card.kind === 'revisited-parks')).toEqual({
      kind: 'revisited-parks',
      parks: [
        {
          featuredImage: null,
          park: {
            name: 'Aulangon kansallispuisto',
            slug: 'aulangon-kansallispuisto'
          },
          previousVisitDate: '2026-05-20',
          revisitCount: 1,
          visitedOn: '2026-06-10'
        }
      ]
    });

    const tripCards = story.cards.filter((card) => card.kind === 'trip-summary');

    expect(tripCards).toEqual([
      {
        featuredImage: {
          alt: 'Kuva käynniltä Repoveden kansallispuisto 2026-06-10',
          fullHeight: 1200,
          fullKey: 'alpha-low-id-full',
          fullWidth: 1600,
          thumbHeight: 600,
          thumbKey: 'alpha-low-id-thumb',
          thumbWidth: 800
        },
        kind: 'trip-summary',
        trip: {
          dateRange: {
            end: '2026-06-10',
            start: '2026-06-10'
          },
          id: 2,
          imageCount: 2,
          name: 'Alpha Escape',
          slug: 'alpha-escape',
          visitCount: 2
        }
      },
      {
        featuredImage: {
          alt: 'Kuva käynniltä Kolin kansallispuisto 2026-06-10',
          fullHeight: 1200,
          fullKey: 'beta-early-full',
          fullWidth: 1600,
          thumbHeight: 600,
          thumbKey: 'beta-early-thumb',
          thumbWidth: 800
        },
        kind: 'trip-summary',
        trip: {
          dateRange: {
            end: '2026-06-10',
            start: '2026-06-10'
          },
          id: 1,
          imageCount: 2,
          name: 'Beta Escape',
          slug: 'beta-escape',
          visitCount: 2
        }
      }
    ]);
  });
});
