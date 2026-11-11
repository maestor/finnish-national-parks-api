import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOsmTrailSnapshot } from '../../src/importer/osm-source.js';

describe('OSM source acquisition', () => {
  it('fetches named walking relations and their complete member geometry', async () => {
    const calls: string[] = [];
    const index = {
      osm3s: { timestamp_osm_base: '2026-11-10T21:21:39Z' },
      elements: [
        {
          type: 'relation',
          id: 1,
          tags: { type: 'route', route: 'hiking', name: 'Polku', distance: '3 km' }
        }
      ]
    };
    const members = {
      osm3s: { timestamp_osm_base: '2026-11-10T21:21:39Z' },
      elements: [
        {
          type: 'relation',
          id: 1,
          members: [
            {
              type: 'way',
              ref: 10,
              geometry: [
                { lon: 25, lat: 61 },
                { lon: 25.01, lat: 61 }
              ]
            }
          ]
        }
      ]
    };
    const result = await fetchOsmTrailSnapshot({
      fetchSource: async (query) => {
        calls.push(query);
        return calls.length === 1 ? index : members;
      }
    });
    expect(calls).toHaveLength(2);
    expect(result.snapshot).toMatchObject({
      timestamp: '2026-11-10T21:21:39Z',
      routes: [
        {
          id: 1,
          name: 'Polku',
          reportedLengthKm: 3,
          geometry: {
            features: [
              {
                geometry: {
                  coordinates: [
                    [25, 61],
                    [25.01, 61]
                  ]
                }
              }
            ]
          }
        }
      ]
    });
    expect(result.rejected).toEqual([]);
    const withoutLength = {
      ...index,
      elements: [{ ...index.elements[0]!, tags: { type: 'route', route: 'foot', name: 'Lyhyt' } }]
    };
    let next = 0;
    const second = await fetchOsmTrailSnapshot({
      fetchSource: async () => (++next === 1 ? withoutLength : members)
    });
    expect(second.snapshot.routes[0]?.reportedLengthKm).toBeNull();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('rejects partial Overpass responses instead of producing an incomplete snapshot', async () => {
    const base = {
      osm3s: { timestamp_osm_base: '2026-11-10T21:21:39Z' },
      elements: [{ type: 'relation', id: 1, tags: { type: 'route', route: 'foot', name: 'Polku' } }]
    };
    await expect(
      fetchOsmTrailSnapshot({ fetchSource: async () => ({ ...base, elements: [] }) })
    ).rejects.toThrow('empty national index');
    let calls = 0;
    await expect(
      fetchOsmTrailSnapshot({
        fetchSource: async () => (++calls === 1 ? base : { ...base, elements: [] })
      })
    ).rejects.toThrow('omitted requested relations');
    await expect(
      fetchOsmTrailSnapshot({ fetchSource: async () => ({ ...base, remark: 'runtime timeout' }) })
    ).rejects.toThrow('incomplete response');
    await expect(
      fetchOsmTrailSnapshot({ fetchSource: async () => ({ elements: [] }) })
    ).rejects.toThrow();
  });
  it('holds ambiguous lengths and missing member geometry for operator review', async () => {
    const timestamp = { timestamp_osm_base: '2026-11-10T21:21:39Z' };
    const roots = [
      {
        type: 'relation',
        id: 1,
        tags: { type: 'route', route: 'foot', name: 'Epäselvä', distance: '60-70' }
      },
      { type: 'relation', id: 2, tags: { type: 'route', route: 'hiking', name: 'Puuttuva' } }
    ];
    const relations = [
      { type: 'relation', id: 1, members: [] },
      { type: 'relation', id: 2, members: [{ type: 'way', ref: 10 }] }
    ];
    let calls = 0;
    const result = await fetchOsmTrailSnapshot({
      fetchSource: async () => ({ osm3s: timestamp, elements: ++calls === 1 ? roots : relations })
    });
    expect(result.snapshot.routes).toHaveLength(0);
    expect(result.rejected).toEqual([
      expect.objectContaining({ id: 1, reason: 'Ambiguous length: 60-70' }),
      expect.objectContaining({ id: 2, reason: 'Missing way geometry 10' })
    ]);
  });
  it('uses a bounded, timed request and surfaces upstream failures', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', mock);
    await expect(fetchOsmTrailSnapshot()).rejects.toThrow('status 503');
    expect(mock).toHaveBeenCalledWith(
      'https://ovp.dresel.systems/api/interpreter',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    );
  });
  it('filters against all area bounds and handles nested relations and source units', async () => {
    const osm3s = { timestamp_osm_base: '2026-11-10T21:21:39Z' };
    const roots = [
      {
        type: 'relation',
        id: 1,
        tags: {
          type: 'route',
          route: 'hiking',
          'name:fi': 'Polku',
          name: 'Trail',
          alt_name: 'A; B',
          length: '1200'
        },
        bounds: { minlon: 25, minlat: 61, maxlon: 26, maxlat: 62 }
      },
      {
        type: 'relation',
        id: 2,
        tags: { type: 'route', route: 'foot', name: 'Kaukana' },
        bounds: { minlon: 30, minlat: 65, maxlon: 31, maxlat: 66 }
      },
      { type: 'relation', id: 3, tags: { type: 'route', route: 'bicycle', name: 'Pyörä' } },
      { type: 'relation', id: 4, tags: { type: 'route', route: 'foot' } },
      { type: 'relation', id: 5, tags: { type: 'route', route: 'foot', name: 'Rajat puuttuvat' } }
    ];
    const members = [
      {
        type: 'relation',
        id: 1,
        members: [
          { type: 'node', ref: 7 },
          { type: 'relation', ref: 11 }
        ]
      },
      {
        type: 'relation',
        id: 11,
        members: [
          {
            type: 'way',
            ref: 10,
            geometry: [
              { lon: 25, lat: 61 },
              { lon: 25.01, lat: 61 }
            ]
          }
        ]
      },
      { type: 'relation', id: 5, members: [] }
    ];
    let calls = 0;
    const result = await fetchOsmTrailSnapshot({
      areas: [{ minLon: 24, minLat: 60, maxLon: 27, maxLat: 63 }],
      fetchSource: async () => ({ osm3s, elements: ++calls === 1 ? roots : members })
    });
    expect(result.snapshot.routes).toMatchObject([
      { id: 1, name: 'Polku', reportedLengthKm: 1.2, aliases: ['Trail', 'Polku', 'A', 'B'] }
    ]);
    expect(result.rejected).toContainEqual({
      id: 5,
      name: 'Rajat puuttuvat',
      reason: 'No way geometry'
    });
  });
  it('reports cyclic and missing nested members rather than joining incomplete geometry', async () => {
    const osm3s = { timestamp_osm_base: '2026-11-10T21:21:39Z' };
    const roots = [1, 2, 3].map((id) => ({
      type: 'relation',
      id,
      tags: { type: 'route', route: 'foot', name: `Polku ${id}` }
    }));
    const relations = [
      { type: 'relation', id: 1, members: [{ type: 'relation', ref: 1 }] },
      { type: 'relation', id: 2, members: [{ type: 'relation', ref: 99 }] },
      {
        type: 'relation',
        id: 3,
        members: [{ type: 'way', ref: 10, geometry: [null, { lon: 25, lat: 61 }] }]
      }
    ];
    let calls = 0;
    const result = await fetchOsmTrailSnapshot({
      fetchSource: async () => ({ osm3s, elements: ++calls === 1 ? roots : relations })
    });
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'Cyclic relation 1',
      'Missing relation 99',
      'Missing way geometry 10'
    ]);
  });
  it('rejects duplicate source identities and fetches large selections in batches', async () => {
    const osm3s = { timestamp_osm_base: '2026-11-10T21:21:39Z' };
    const root = { type: 'relation', id: 1, tags: { type: 'route', route: 'foot', name: 'Polku' } };
    await expect(
      fetchOsmTrailSnapshot({ fetchSource: async () => ({ osm3s, elements: [root, root] }) })
    ).rejects.toThrow('duplicate relation IDs');
    const roots = Array.from({ length: 151 }, (_, i) => ({ ...root, id: i + 1 }));
    let calls = 0;
    const result = await fetchOsmTrailSnapshot({
      fetchSource: async () => ({
        osm3s,
        elements:
          ++calls === 1 ? roots : roots.map((r) => ({ type: 'relation', id: r.id, members: [] }))
      })
    });
    expect(calls).toBe(3);
    expect(result.rejected).toHaveLength(151);
  });
  it('parses a successful HTTP response', async () => {
    const data = {
      osm3s: { timestamp_osm_base: '2026-11-10T21:21:39Z' },
      elements: [{ type: 'relation', id: 1, tags: { type: 'route', route: 'bicycle' } }]
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
    expect((await fetchOsmTrailSnapshot()).snapshot.routes).toEqual([]);
  });
});
