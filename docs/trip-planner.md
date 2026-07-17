# Trip Planner Guide

This guide documents the current backend logic for the Roadtrip / trip planner search family.

It is meant to answer two questions quickly:

- what the trip-planner endpoints do
- why the current search heuristics behave the way they do

## Endpoints

- `POST /api/trip-planner/suggestions`
  - accepts `{ query }`
  - returns up to three Geoapify-backed place suggestions with `label` and `coordinate`
- `POST /api/trip-planner/search`
  - accepts `originQuery`, `destinationQuery`, `mode`, and optional `maxDistanceKm`
  - geocodes the endpoints server-side
  - fetches a real driving route from Geoapify
  - returns visible catalog parks near that route
  - returns response-level `maxDistanceKm` and `defaultDistanceKm` values for frontend distance filters
- `POST /api/trip-planner/nearby`
  - accepts `originQuery` and optional `maxDistanceKm`
  - geocodes only the origin server-side
  - returns visible catalog parks near that point
  - returns a `searchArea` bounding box and center for map rendering without route geometry
  - returns the same response-level `maxDistanceKm` and `defaultDistanceKm` fields as route search

Both endpoints require the existing backend auth boundary outside localhost and depend on `GEOAPIFY_API_KEY`.

## Core Definitions

- `corridor distance`
  - the maximum allowed distance from the route for a park to qualify
  - today the default search value remains `25 km`
- `distanceFromRouteKm`
  - the shortest side-distance from the routed path to the park geometry or marker point
- `distanceFromOriginKm`
  - the shortest straight-line distance from the origin point to the park geometry or marker point
- `maxDistanceKm`
  - the effective corridor or nearby distance limit used for the request
- `defaultDistanceKm`
  - the frontend-friendly default filter distance
  - for route search, this is the route length in kilometers rounded up and capped by `maxDistanceKm`
  - for nearby search, this always matches `maxDistanceKm`
- `distanceAlongRoute`
  - where the park sits along the trip, measured from the route origin to the closest point on the route
- `start zone`
  - the first `30 km` of the trip from the route origin
- `long trip`
  - a routed trip of at least `100 km`

## Current Search Logic

The planner still uses a route-corridor model rather than straight-line proximity.

That means the main inclusion question is still:

- is this park close enough to the route we would actually drive?

The current backend then refines that with long-trip behavior:

1. Keep the broad default `25 km` corridor for normal eligibility.
2. On trips shorter than `100 km`, keep the existing behavior.
3. On trips of at least `100 km`, treat the first `30 km` as a special start zone.
4. Inside that start zone, apply a stricter effective side-distance limit of `10 km`.
5. For the remaining qualified results on long trips, prefer later-route matches ahead of start-zone matches within the same result group.
6. Return `defaultDistanceKm` as the route length rounded up to the next kilometer, capped by `maxDistanceKm`, so short trips do not default to the full corridor width in the UI.

This is intended to reduce dense departure-area flooding such as Uusimaa or the capital region without making Lapland-style long-distance searches too strict.

## Nearby-Origin Logic

The nearby endpoint is intentionally simpler than route search.

It asks a different inclusion question:

- is this park close enough to the chosen origin point, even when there is no trip route?

Current nearby behavior:

1. Geocode the origin only.
2. Build a search area from the origin point with the same default `25 km` distance.
3. Filter parks by straight-line distance from the origin to stored park geometry, or to bounding-box / marker fallbacks when full geometry is missing.
4. Return the origin, matching parks, and a backend-provided `searchArea` bounding box for the map.
5. Return `defaultDistanceKm` equal to `maxDistanceKm` because there is no route-length-based default to derive.

The nearby endpoint does not use:

- routed Geoapify path geometry
- `distanceAlongRoute`
- long-trip thresholds
- start-zone tightening

## Result Ordering

The existing public ordering intent still applies first:

1. Unvisited national parks
2. Other unvisited non-trail areas
3. Unvisited trails, capped to the nearest 10
4. Visited results

Within each group:

- shorter route distance still matters
- on long trips, later-route matches are favored over remaining start-zone matches
- name breaks remaining ties

For the nearby endpoint, the same group order is reused, but the distance sort uses `distanceFromOriginKm` instead of route distance.

## Tuning Knobs

The current backend constants are intentionally simple and can be adjusted after real use:

- default corridor: `25 km`
- long-trip threshold: `100 km`
- start-zone length: `30 km`
- start-zone side-distance limit: `10 km`

If future tuning is needed, change these carefully and verify with both:

- dense southern departures such as `Vantaa -> Oulu`
- sparse northern routes such as `Vantaa -> Nuorgam`

## Main Touchpoints

- [src/trip-planner/search.ts](../src/trip-planner/search.ts)
- [src/trip-planner/geometry.ts](../src/trip-planner/geometry.ts)
- [src/contracts/trip-planner.ts](../src/contracts/trip-planner.ts)
- [src/routes/trip-planner.ts](../src/routes/trip-planner.ts)
- [tests/unit/trip-planner-search.test.ts](../tests/unit/trip-planner-search.test.ts)
- [tests/unit/trip-planner-geometry.test.ts](../tests/unit/trip-planner-geometry.test.ts)
- [tests/integration/trip-planner.integration.test.ts](../tests/integration/trip-planner.integration.test.ts)
