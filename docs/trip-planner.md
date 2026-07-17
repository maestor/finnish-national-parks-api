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

Both endpoints require the existing backend auth boundary outside localhost and depend on `GEOAPIFY_API_KEY`.

## Core Definitions

- `corridor distance`
  - the maximum allowed distance from the route for a park to qualify
  - today the default search value remains `25 km`
- `distanceFromRouteKm`
  - the shortest side-distance from the routed path to the park geometry or marker point
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

This is intended to reduce dense departure-area flooding such as Uusimaa or the capital region without making Lapland-style long-distance searches too strict.

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
