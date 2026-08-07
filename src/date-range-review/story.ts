import type { YearReviewStoryImageAsset } from '../year-review/story.js';

export type DateRangeReviewTimelineVisit = {
  createdAt: string;
  id: number;
  imageCount: number;
  park: {
    name: string;
    slug: string;
    typeLabel: string;
    typeSlug: string;
  };
  route: string | null;
  trip: {
    id: number;
    name: string;
    slug: string;
  } | null;
  tripStopOrder: number | null;
  visitedOn: string;
};

export type DateRangeReviewTrip = {
  dateRange: {
    end: string;
    start: string;
  } | null;
  description: string | null;
  id: number;
  name: string;
  slug: string;
  visitCount: number;
};

export type DateRangeReviewSummary = {
  distinctParkCount: number;
  imageCount: number;
  newNationalParkCount: number;
  revisitedParkCount: number;
  tripCount: number;
  visitCount: number;
};

export type DateRangeReviewVisitReference = {
  id: number;
  imageCount: number;
  park: {
    name: string;
    slug: string;
  };
  route: string | null;
  trip: {
    id: number;
    name: string;
    slug: string;
  } | null;
  visitedOn: string;
};

export type DateRangeReviewParkVisitSummary = {
  park: {
    name: string;
    slug: string;
    typeLabel: string;
    typeSlug: string;
  };
  visitedOn: string;
};

export type DateRangeReviewCard =
  | {
      dateRange: {
        endDate: string;
        startDate: string;
      };
      kind: 'intro';
      name: string;
      primaryStat: {
        key: 'visitCount';
        value: number;
      };
      tripCount: number;
    }
  | {
      featuredImage: YearReviewStoryImageAsset | null;
      kind: 'photo-highlight';
      totalImageCount: number;
      visit: DateRangeReviewVisitReference | null;
    }
  | {
      kind: 'new-parks';
      parks: Array<{
        featuredImage: YearReviewStoryImageAsset | null;
        park: {
          name: string;
          slug: string;
        };
        visitedOn: string;
      }>;
    }
  | {
      kind: 'revisited-parks';
      parks: Array<{
        featuredImage: YearReviewStoryImageAsset | null;
        park: {
          name: string;
          slug: string;
        };
        previousVisitDate: string;
        revisitCount: number;
        visitedOn: string;
      }>;
    }
  | {
      featuredImage: YearReviewStoryImageAsset | null;
      kind: 'trip-summary';
      trip: {
        dateRange: {
          end: string;
          start: string;
        } | null;
        id: number;
        imageCount: number;
        name: string;
        slug: string;
        visits: DateRangeReviewParkVisitSummary[];
        visitCount: number;
      };
    }
  | {
      kind: 'other-visits';
      visits: DateRangeReviewParkVisitSummary[];
    };

export type DateRangeReviewStory = {
  cards: DateRangeReviewCard[];
  summary: DateRangeReviewSummary;
};

const NATIONAL_PARK_TYPE_SLUG = 'national-park';

const compareVisitsByNarrativeOrder = (
  left: DateRangeReviewTimelineVisit,
  right: DateRangeReviewTimelineVisit
) => {
  return (
    left.visitedOn.localeCompare(right.visitedOn) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id - right.id
  );
};

const toVisitReference = (visit: DateRangeReviewTimelineVisit): DateRangeReviewVisitReference => ({
  id: visit.id,
  imageCount: visit.imageCount,
  park: {
    name: visit.park.name,
    slug: visit.park.slug
  },
  route: visit.route,
  trip: visit.trip,
  visitedOn: visit.visitedOn
});

const toParkVisitSummary = (
  visit: DateRangeReviewTimelineVisit
): DateRangeReviewParkVisitSummary => ({
  park: {
    name: visit.park.name,
    slug: visit.park.slug,
    typeLabel: visit.park.typeLabel,
    typeSlug: visit.park.typeSlug
  },
  visitedOn: visit.visitedOn
});

const buildVisitFeaturedImageAlt = (visit: DateRangeReviewTimelineVisit) => {
  return `Kuva käynniltä ${visit.park.name} ${visit.visitedOn}`;
};

const getFeaturedImageForVisit = (
  visit: DateRangeReviewTimelineVisit | null,
  visitImagesByVisitId: Map<number, YearReviewStoryImageAsset[]>
) => {
  if (!visit) {
    return null;
  }

  const image = visitImagesByVisitId.get(visit.id)?.[0] ?? null;

  if (!image) {
    return null;
  }

  return {
    ...image,
    alt: buildVisitFeaturedImageAlt(visit)
  };
};

const isWithinRange = (visitedOn: string, startDate: string, endDate: string) =>
  visitedOn >= startDate && visitedOn <= endDate;

const buildEarliestVisitDateByPark = (visits: DateRangeReviewTimelineVisit[]) => {
  const earliestVisitDateByPark = new Map<string, string>();

  for (const visit of visits) {
    const current = earliestVisitDateByPark.get(visit.park.slug);

    if (!current || visit.visitedOn < current) {
      earliestVisitDateByPark.set(visit.park.slug, visit.visitedOn);
    }
  }

  return earliestVisitDateByPark;
};

const buildLatestPreviousVisitDateByPark = (
  visits: DateRangeReviewTimelineVisit[],
  startDate: string
) => {
  const latestPreviousVisitDateByPark = new Map<string, string>();

  for (const visit of visits) {
    if (visit.visitedOn >= startDate) {
      continue;
    }

    const current = latestPreviousVisitDateByPark.get(visit.park.slug);

    if (!current || visit.visitedOn > current) {
      latestPreviousVisitDateByPark.set(visit.park.slug, visit.visitedOn);
    }
  }

  return latestPreviousVisitDateByPark;
};

export const createDateRangeReviewSharePath = (shareId: string) =>
  `/ajanjaksokatsaus/jako/${shareId}`;

export const buildDateRangeReviewStory = ({
  endDate,
  name,
  overviewSlug: _overviewSlug,
  startDate,
  trips,
  visitImagesByVisitId = new Map<number, YearReviewStoryImageAsset[]>(),
  visits
}: {
  endDate: string;
  name: string;
  overviewSlug: string;
  startDate: string;
  trips: DateRangeReviewTrip[];
  visitImagesByVisitId?: Map<number, YearReviewStoryImageAsset[]>;
  visits: DateRangeReviewTimelineVisit[];
}): DateRangeReviewStory => {
  const earliestVisitDateByPark = buildEarliestVisitDateByPark(visits);
  const latestPreviousVisitDateByPark = buildLatestPreviousVisitDateByPark(visits, startDate);
  const rangeVisits = visits
    .filter((visit) => isWithinRange(visit.visitedOn, startDate, endDate))
    .sort(compareVisitsByNarrativeOrder);
  const distinctParkSlugs = new Set<string>();
  const revisitCountsByPark = new Map<string, number>();
  const tripStatsByTripId = new Map<
    number,
    {
      firstVisitedOn: string;
      imageCount: number;
      lastVisitedOn: string;
      trip: DateRangeReviewTrip;
      visits: DateRangeReviewTimelineVisit[];
      visitCount: number;
    }
  >();
  let imageCount = 0;

  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

  for (const visit of rangeVisits) {
    distinctParkSlugs.add(visit.park.slug);
    imageCount += visit.imageCount;

    if (latestPreviousVisitDateByPark.has(visit.park.slug)) {
      revisitCountsByPark.set(visit.park.slug, (revisitCountsByPark.get(visit.park.slug) ?? 0) + 1);
    }

    if (visit.trip) {
      const trip = tripsById.get(visit.trip.id);

      if (trip) {
        const existing = tripStatsByTripId.get(trip.id);

        if (existing) {
          existing.lastVisitedOn = visit.visitedOn;
          existing.imageCount += visit.imageCount;
          existing.visits.push(visit);
          existing.visitCount += 1;
        } else {
          tripStatsByTripId.set(trip.id, {
            firstVisitedOn: visit.visitedOn,
            imageCount: visit.imageCount,
            lastVisitedOn: visit.visitedOn,
            trip,
            visits: [visit],
            visitCount: 1
          });
        }
      }
    }
  }

  const photoVisit =
    [...rangeVisits].sort(
      (left, right) =>
        right.imageCount - left.imageCount || compareVisitsByNarrativeOrder(left, right)
    )[0] ?? null;
  const seenNewNationalParkSlugs = new Set<string>();
  const newNationalParkMoments = rangeVisits.flatMap((visit) => {
    if (
      visit.park.typeSlug !== NATIONAL_PARK_TYPE_SLUG ||
      earliestVisitDateByPark.get(visit.park.slug) !== visit.visitedOn ||
      seenNewNationalParkSlugs.has(visit.park.slug)
    ) {
      return [];
    }

    seenNewNationalParkSlugs.add(visit.park.slug);

    return [
      {
        featuredImage: getFeaturedImageForVisit(visit, visitImagesByVisitId),
        park: {
          name: visit.park.name,
          slug: visit.park.slug
        },
        visitId: visit.id,
        visitedOn: visit.visitedOn
      }
    ];
  });
  const seenRevisitedParkSlugs = new Set<string>();
  const revisitedParkMoments = rangeVisits.flatMap((visit) => {
    const previousVisitDate = latestPreviousVisitDateByPark.get(visit.park.slug);
    const revisitCount = revisitCountsByPark.get(visit.park.slug);

    if (
      !previousVisitDate ||
      revisitCount === undefined ||
      seenRevisitedParkSlugs.has(visit.park.slug)
    ) {
      return [];
    }

    seenRevisitedParkSlugs.add(visit.park.slug);

    return [
      {
        featuredImage: getFeaturedImageForVisit(visit, visitImagesByVisitId),
        park: {
          name: visit.park.name,
          slug: visit.park.slug
        },
        previousVisitDate,
        revisitCount,
        visitId: visit.id,
        visitedOn: visit.visitedOn
      }
    ];
  });

  const summary: DateRangeReviewSummary = {
    distinctParkCount: distinctParkSlugs.size,
    imageCount,
    newNationalParkCount: newNationalParkMoments.length,
    revisitedParkCount: revisitedParkMoments.length,
    tripCount: tripStatsByTripId.size,
    visitCount: rangeVisits.length
  };

  const cards: DateRangeReviewCard[] = [
    {
      dateRange: {
        endDate,
        startDate
      },
      kind: 'intro',
      name,
      primaryStat: {
        key: 'visitCount',
        value: summary.visitCount
      },
      tripCount: summary.tripCount
    },
    {
      featuredImage: getFeaturedImageForVisit(photoVisit, visitImagesByVisitId),
      kind: 'photo-highlight',
      totalImageCount: summary.imageCount,
      visit: photoVisit ? toVisitReference(photoVisit) : null
    }
  ];

  if (newNationalParkMoments.length > 0) {
    cards.push({
      kind: 'new-parks',
      parks: newNationalParkMoments.map(({ visitId: _visitId, ...parkMoment }) => parkMoment)
    });
  }

  if (revisitedParkMoments.length > 0) {
    cards.push({
      kind: 'revisited-parks',
      parks: revisitedParkMoments.map(({ visitId: _visitId, ...parkMoment }) => parkMoment)
    });
  }

  const coveredVisitIds = new Set<number>();

  if (photoVisit) {
    coveredVisitIds.add(photoVisit.id);
  }

  for (const visit of rangeVisits) {
    if (visit.trip && tripStatsByTripId.has(visit.trip.id)) {
      coveredVisitIds.add(visit.id);
    }
  }

  for (const parkMoment of newNationalParkMoments) {
    coveredVisitIds.add(parkMoment.visitId);
  }

  for (const parkMoment of revisitedParkMoments) {
    coveredVisitIds.add(parkMoment.visitId);
  }

  const tripCards = [...tripStatsByTripId.values()]
    .sort(
      (left, right) =>
        left.firstVisitedOn.localeCompare(right.firstVisitedOn) ||
        left.trip.name.localeCompare(right.trip.name, 'fi')
    )
    .map((entry) => {
      const featuredVisit = [...rangeVisits]
        .filter((visit) => visit.trip?.id === entry.trip.id)
        .sort(
          (left, right) =>
            right.imageCount - left.imageCount || compareVisitsByNarrativeOrder(left, right)
        )[0]!;

      return {
        featuredImage: getFeaturedImageForVisit(featuredVisit, visitImagesByVisitId),
        kind: 'trip-summary' as const,
        trip: {
          dateRange: {
            end: entry.lastVisitedOn,
            start: entry.firstVisitedOn
          },
          id: entry.trip.id,
          imageCount: entry.imageCount,
          name: entry.trip.name,
          slug: entry.trip.slug,
          visits: [...entry.visits].sort(compareVisitsByNarrativeOrder).map(toParkVisitSummary),
          visitCount: entry.visitCount
        }
      };
    });

  cards.push(...tripCards);

  const otherVisits = rangeVisits
    .filter((visit) => !coveredVisitIds.has(visit.id))
    .map(toParkVisitSummary);

  if (otherVisits.length > 0) {
    cards.push({
      kind: 'other-visits',
      visits: otherVisits
    });
  }

  return {
    cards,
    summary
  };
};
