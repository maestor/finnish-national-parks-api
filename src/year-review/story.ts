export type YearReviewSeason = 'autumn' | 'spring' | 'summer' | 'winter';

export type YearReviewTimelineVisit = {
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

export type YearReviewTrip = {
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

export type YearReviewSummary = {
  activeMonthCount: number;
  distinctParkCount: number;
  imageCount: number;
  newParkCount: number;
  revisitedParkCount: number;
  visitCount: number;
  visitsBySeason: Record<YearReviewSeason, number>;
};

export type YearReviewVisitReference = {
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

export type YearReviewStoryImageAsset = {
  alt: string | null;
  fullHeight: number | null;
  fullKey: string;
  fullWidth: number | null;
  thumbHeight: number | null;
  thumbKey: string;
  thumbWidth: number | null;
};

export type YearReviewCard =
  | {
      kind: 'intro';
      primaryStat: {
        key: 'visitCount';
        value: number;
      };
      year: number;
    }
  | {
      featuredImage: YearReviewStoryImageAsset | null;
      kind: 'milestone';
      milestone: 'first-visit' | 'last-visit';
      visit: YearReviewVisitReference;
    }
  | {
      featuredImage: YearReviewStoryImageAsset | null;
      kind: 'photo-highlight';
      totalImageCount: number;
      visit: YearReviewVisitReference | null;
    }
  | {
      busiestMonth: number | null;
      busiestWeekday: number | null;
      kind: 'profile';
      mostVisitedPark: {
        name: string;
        slug: string;
        visitCount: number;
      } | null;
      topRoute: string | null;
      topTypeLabel: string | null;
    }
  | {
      featuredImage: YearReviewStoryImageAsset | null;
      kind: 'trip-highlight';
      trip: {
        dateRange: {
          end: string;
          start: string;
        } | null;
        id: number;
        imageCount: number;
        name: string;
        slug: string;
        visitCount: number;
      };
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
      kind: 'seasonal';
      strongestSeason: YearReviewSeason | null;
      visitsBySeason: Record<YearReviewSeason, number>;
    }
  | {
      highlights: string[];
      kind: 'summary';
    };

export type YearReviewStory = {
  cards: YearReviewCard[];
  summary: YearReviewSummary;
  year: number;
};

const getVisitYear = (visitedOn: string) => Number.parseInt(visitedOn.slice(0, 4), 10);

const getVisitMonth = (visitedOn: string) => Number.parseInt(visitedOn.slice(5, 7), 10);

const getVisitWeekday = (visitedOn: string) => new Date(`${visitedOn}T12:00:00Z`).getUTCDay();

const getSeason = (month: number): YearReviewSeason => {
  if (month >= 3 && month <= 5) {
    return 'spring';
  }

  if (month >= 6 && month <= 8) {
    return 'summer';
  }

  if (month >= 9 && month <= 11) {
    return 'autumn';
  }

  return 'winter';
};

const compareVisitsByNarrativeOrder = (
  left: YearReviewTimelineVisit,
  right: YearReviewTimelineVisit
) => {
  return (
    left.visitedOn.localeCompare(right.visitedOn) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id - right.id
  );
};

const compareCountsAscendingKey = <Key extends string | number>(
  left: [Key, number],
  right: [Key, number]
) => {
  return right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), 'fi');
};

const NATIONAL_PARK_TYPE_SLUG = 'national-park';

const toVisitReference = (visit: YearReviewTimelineVisit): YearReviewVisitReference => ({
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

const buildVisitFeaturedImageAlt = (visit: YearReviewTimelineVisit) => {
  return `Kuva käynniltä ${visit.park.name} ${visit.visitedOn}`;
};

const getFeaturedImageForVisit = (
  visit: YearReviewTimelineVisit | null,
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

const selectTripHighlightVisit = ({
  excludedVisitIds,
  strongestTripId,
  visits
}: {
  excludedVisitIds: Set<number>;
  strongestTripId: number;
  visits: YearReviewTimelineVisit[];
}) => {
  const preferredVisit =
    visits.find(
      (visit) =>
        visit.trip?.id === strongestTripId &&
        visit.imageCount > 0 &&
        !excludedVisitIds.has(visit.id)
    ) ?? null;

  if (preferredVisit) {
    return preferredVisit;
  }

  // Fall back to any imaged visit from the selected trip so the trip card
  // still gets a featured image when the trip's photos are already used by
  // other cards like first/last visit or photo highlight.
  return visits.find((visit) => visit.trip?.id === strongestTripId && visit.imageCount > 0) ?? null;
};

const buildEarliestVisitYearByPark = (visits: YearReviewTimelineVisit[]) => {
  const earliestVisitYearByPark = new Map<string, number>();

  for (const visit of visits) {
    const year = getVisitYear(visit.visitedOn);
    const current = earliestVisitYearByPark.get(visit.park.slug);

    if (current === undefined || year < current) {
      earliestVisitYearByPark.set(visit.park.slug, year);
    }
  }

  return earliestVisitYearByPark;
};

const buildHighlights = (
  summary: YearReviewSummary,
  mostVisitedPark: {
    name: string;
    slug: string;
    visitCount: number;
  } | null,
  strongestTrip: {
    name: string;
    visitCount: number;
  } | null
) => {
  const highlights = [
    `${summary.visitCount} visits`,
    `${summary.distinctParkCount} distinct parks`,
    `${summary.imageCount} photos`
  ];

  if (mostVisitedPark) {
    highlights.push(`${mostVisitedPark.name} x${mostVisitedPark.visitCount}`);
  }

  if (strongestTrip) {
    highlights.push(`${strongestTrip.name} (${strongestTrip.visitCount} visits)`);
  }

  return highlights;
};

export const createYearReviewSharePath = (shareId: string) => `/vuosikatsaus/jako/${shareId}`;

export const buildYearReviewStory = ({
  trips,
  visitImagesByVisitId = new Map<number, YearReviewStoryImageAsset[]>(),
  visits,
  year
}: {
  trips: YearReviewTrip[];
  visitImagesByVisitId?: Map<number, YearReviewStoryImageAsset[]>;
  visits: YearReviewTimelineVisit[];
  year: number;
}): YearReviewStory => {
  const earliestVisitYearByPark = buildEarliestVisitYearByPark(visits);
  const yearVisits = visits
    .filter((visit) => getVisitYear(visit.visitedOn) === year)
    .sort(compareVisitsByNarrativeOrder);
  const activeMonths = new Set<number>();
  const visitsByPark = new Map<string, { name: string; slug: string; visitCount: number }>();
  const visitsByRoute = new Map<string, number>();
  const visitsByTypeLabel = new Map<string, number>();
  const visitsByMonth = new Map<number, number>();
  const visitsByWeekday = new Map<number, number>();
  const visitsByTrip = new Map<
    number,
    { imageCount: number; trip: YearReviewTrip; visitCount: number }
  >();
  const visitsBySeason: Record<YearReviewSeason, number> = {
    autumn: 0,
    spring: 0,
    summer: 0,
    winter: 0
  };
  let imageCount = 0;

  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

  for (const visit of yearVisits) {
    const month = getVisitMonth(visit.visitedOn);
    const weekday = getVisitWeekday(visit.visitedOn);
    const season = getSeason(month);
    const parkEntry = visitsByPark.get(visit.park.slug) ?? {
      name: visit.park.name,
      slug: visit.park.slug,
      visitCount: 0
    };

    parkEntry.visitCount += 1;
    visitsByPark.set(visit.park.slug, parkEntry);
    activeMonths.add(month);
    imageCount += visit.imageCount;
    visitsByMonth.set(month, (visitsByMonth.get(month) ?? 0) + 1);
    visitsByWeekday.set(weekday, (visitsByWeekday.get(weekday) ?? 0) + 1);
    visitsByTypeLabel.set(
      visit.park.typeLabel,
      (visitsByTypeLabel.get(visit.park.typeLabel) ?? 0) + 1
    );
    visitsBySeason[season] += 1;

    if (visit.route) {
      visitsByRoute.set(visit.route, (visitsByRoute.get(visit.route) ?? 0) + 1);
    }

    if (visit.trip) {
      const trip = tripsById.get(visit.trip.id);

      if (trip) {
        const tripEntry = visitsByTrip.get(trip.id) ?? {
          imageCount: 0,
          trip,
          visitCount: 0
        };

        tripEntry.imageCount += visit.imageCount;
        tripEntry.visitCount += 1;
        visitsByTrip.set(trip.id, tripEntry);
      }
    }
  }

  let newParkCount = 0;

  for (const slug of visitsByPark.keys()) {
    if (earliestVisitYearByPark.get(slug) === year) {
      newParkCount += 1;
    }
  }

  const summary: YearReviewSummary = {
    activeMonthCount: activeMonths.size,
    distinctParkCount: visitsByPark.size,
    imageCount,
    newParkCount,
    revisitedParkCount: visitsByPark.size - newParkCount,
    visitCount: yearVisits.length,
    visitsBySeason
  };

  const firstVisit = yearVisits[0] ?? null;
  const lastVisit = yearVisits.at(-1) ?? null;
  const photoVisit =
    [...yearVisits].sort(
      (left, right) =>
        right.imageCount - left.imageCount || compareVisitsByNarrativeOrder(left, right)
    )[0] ?? null;
  const firstVisitImage = getFeaturedImageForVisit(firstVisit, visitImagesByVisitId);
  const lastVisitImage = getFeaturedImageForVisit(lastVisit, visitImagesByVisitId);
  const photoVisitImage = getFeaturedImageForVisit(photoVisit, visitImagesByVisitId);
  const mostVisitedPark =
    [...visitsByPark.values()].sort(
      (left, right) =>
        right.visitCount - left.visitCount || left.name.localeCompare(right.name, 'fi')
    )[0] ?? null;
  const topRoute = [...visitsByRoute.entries()].sort(compareCountsAscendingKey)[0]?.[0] ?? null;
  const topTypeLabel =
    [...visitsByTypeLabel.entries()].sort(compareCountsAscendingKey)[0]?.[0] ?? null;
  const busiestMonth = [...visitsByMonth.entries()].sort(compareCountsAscendingKey)[0]?.[0] ?? null;
  const busiestWeekday =
    [...visitsByWeekday.entries()].sort(compareCountsAscendingKey)[0]?.[0] ?? null;
  const strongestSeason = [...Object.entries(visitsBySeason)].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fi')
  )[0]?.[1]
    ? ([...Object.entries(visitsBySeason)].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fi')
      )[0]?.[0] as YearReviewSeason)
    : null;
  const strongestTripEntry =
    [...visitsByTrip.values()].sort(
      (left, right) =>
        right.visitCount - left.visitCount ||
        right.imageCount - left.imageCount ||
        left.trip.name.localeCompare(right.trip.name, 'fi')
    )[0] ?? null;
  const tripHighlightExcludedVisitIds = new Set(
    [firstVisit?.id, lastVisit?.id, photoVisit?.id].filter(
      (value): value is number => value !== undefined
    )
  );
  const tripHighlightVisit =
    strongestTripEntry === null
      ? null
      : selectTripHighlightVisit({
          excludedVisitIds: tripHighlightExcludedVisitIds,
          strongestTripId: strongestTripEntry.trip.id,
          visits: yearVisits
        });
  const tripHighlightImage = getFeaturedImageForVisit(tripHighlightVisit, visitImagesByVisitId);
  const seenNewNationalParkSlugs = new Set<string>();
  const newNationalParkMoments = yearVisits.flatMap((visit) => {
    if (
      visit.park.typeSlug !== NATIONAL_PARK_TYPE_SLUG ||
      earliestVisitYearByPark.get(visit.park.slug) !== year ||
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
        visitedOn: visit.visitedOn
      }
    ];
  });

  const cards: YearReviewCard[] = [
    {
      kind: 'intro',
      primaryStat: {
        key: 'visitCount',
        value: summary.visitCount
      },
      year
    }
  ];

  if (firstVisit) {
    cards.push({
      featuredImage: firstVisitImage,
      kind: 'milestone',
      milestone: 'first-visit',
      visit: toVisitReference(firstVisit)
    });
  }

  if (lastVisit && lastVisit.id !== firstVisit?.id) {
    cards.push({
      featuredImage: lastVisitImage,
      kind: 'milestone',
      milestone: 'last-visit',
      visit: toVisitReference(lastVisit)
    });
  }

  cards.push({
    featuredImage: photoVisitImage,
    kind: 'photo-highlight',
    totalImageCount: summary.imageCount,
    visit: photoVisit ? toVisitReference(photoVisit) : null
  });

  cards.push({
    busiestMonth,
    busiestWeekday,
    kind: 'profile',
    mostVisitedPark,
    topRoute,
    topTypeLabel
  });

  if (strongestTripEntry) {
    cards.push({
      featuredImage: tripHighlightImage,
      kind: 'trip-highlight',
      trip: {
        dateRange: strongestTripEntry.trip.dateRange,
        id: strongestTripEntry.trip.id,
        imageCount: strongestTripEntry.imageCount,
        name: strongestTripEntry.trip.name,
        slug: strongestTripEntry.trip.slug,
        visitCount: strongestTripEntry.visitCount
      }
    });
  }

  if (newNationalParkMoments.length > 0) {
    cards.push({
      kind: 'new-parks',
      parks: newNationalParkMoments
    });
  }

  cards.push({
    kind: 'seasonal',
    strongestSeason,
    visitsBySeason
  });

  cards.push({
    highlights: buildHighlights(
      summary,
      mostVisitedPark,
      strongestTripEntry
        ? {
            name: strongestTripEntry.trip.name,
            visitCount: strongestTripEntry.visitCount
          }
        : null
    ),
    kind: 'summary'
  });

  return {
    cards,
    summary,
    year
  };
};
