import { describe, expect, it, vi } from 'vitest';

import { createGeoapifyClient } from '../../src/trip-planner/geoapify.js';

describe('geoapify client', () => {
  it('geocodes with a Finland bias and normalizes the best result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              formatted: 'Helsinki, Finland',
              lat: 60.1699,
              lon: 24.9384
            }
          ]
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200
        }
      )
    );
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: fetchFn as typeof fetch
    });

    const result = await client.geocode('Helsinki');
    const requestUrl = new URL(String(fetchFn.mock.calls[0]?.[0]));

    expect(requestUrl.pathname).toBe('/v1/geocode/search');
    expect(requestUrl.searchParams.get('text')).toBe('Helsinki');
    expect(requestUrl.searchParams.get('bias')).toBe('countrycode:fi');
    expect(requestUrl.searchParams.get('lang')).toBe('fi');
    expect(result).toEqual({
      coordinate: {
        lat: 60.1699,
        lon: 24.9384
      },
      label: 'Helsinki, Finland'
    });
  });

  it('normalizes routing geometry into repo-owned GeoJSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: {
                coordinates: [
                  [
                    [24.93, 60.17],
                    [25.01, 60.18]
                  ]
                ],
                type: 'MultiLineString'
              },
              properties: {
                distance: 8_450,
                time: 760
              }
            }
          ]
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200
        }
      )
    );
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: fetchFn as typeof fetch
    });

    const route = await client.route({
      destination: { lat: 60.18, lon: 25.01 },
      mode: 'drive',
      origin: { lat: 60.17, lon: 24.93 }
    });
    const requestUrl = new URL(String(fetchFn.mock.calls[0]?.[0]));

    expect(requestUrl.pathname).toBe('/v1/routing');
    expect(requestUrl.searchParams.get('mode')).toBe('drive');
    expect(requestUrl.searchParams.get('waypoints')).toBe('60.17,24.93|60.18,25.01');
    expect(route).toMatchObject({
      distanceMeters: 8_450,
      durationSeconds: 760,
      mode: 'drive'
    });
    expect(route?.geometry.features).toEqual([
      {
        geometry: {
          coordinates: [
            [24.93, 60.17],
            [25.01, 60.18]
          ],
          type: 'LineString'
        },
        type: 'Feature'
      }
    ]);
  });

  it('throws when Geoapify returns a failing response', async () => {
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: vi.fn().mockResolvedValue(new Response('oops', { status: 503 })) as typeof fetch
    });

    await expect(client.geocode('Helsinki')).rejects.toThrow('Geoapify request failed');
  });

  it('returns null when geocoding responds with no matches', async () => {
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      ) as typeof fetch
    });

    await expect(client.geocode('Missing place')).resolves.toBeNull();
  });

  it('returns null when Geoapify responds with 404', async () => {
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: vi.fn().mockResolvedValue(new Response('missing', { status: 404 })) as typeof fetch
    });

    await expect(client.geocode('Missing place')).resolves.toBeNull();
  });

  it('returns null when routing geometry is missing or too short', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  coordinates: [],
                  type: 'MultiLineString'
                },
                properties: {
                  distance: 10,
                  time: 20
                }
              }
            ]
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  coordinates: [[[24.93, 60.17]]],
                  type: 'MultiLineString'
                },
                properties: {
                  distance: 10,
                  time: 20
                }
              }
            ]
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200
          }
        )
      );
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: fetchFn as typeof fetch
    });

    await expect(
      client.route({
        destination: { lat: 60.18, lon: 25.01 },
        mode: 'drive',
        origin: { lat: 60.17, lon: 24.93 }
      })
    ).resolves.toBeNull();

    await expect(
      client.route({
        destination: { lat: 60.18, lon: 25.01 },
        mode: 'drive',
        origin: { lat: 60.17, lon: 24.93 }
      })
    ).resolves.toBeNull();
  });

  it('returns null when routing metadata is incomplete', async () => {
    const client = createGeoapifyClient({
      apiKey: 'geoapify-test',
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [24.93, 60.17],
                      [25.01, 60.18]
                    ]
                  ],
                  type: 'MultiLineString'
                },
                properties: {
                  distance: 8_450
                }
              }
            ]
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200
          }
        )
      ) as typeof fetch
    });

    await expect(
      client.route({
        destination: { lat: 60.18, lon: 25.01 },
        mode: 'drive',
        origin: { lat: 60.17, lon: 24.93 }
      })
    ).resolves.toBeNull();
  });
});
