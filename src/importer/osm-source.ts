import { z } from 'zod';
import type { GeoJsonCoordinate, GeoJsonFeature } from './geometry.js';
import type { OsmRoute, OsmSnapshot } from './import-osm-trails.js';

const OVERPASS_URL = 'https://ovp.dresel.systems/api/interpreter';
const batchSize = 150;
const tagsSchema = z.record(z.string(), z.string());
const pointSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90)
});
const memberSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  ref: z.number().int().positive(),
  geometry: z.array(pointSchema.nullable()).optional()
});
const elementSchema = z.object({
  type: z.literal('relation'),
  id: z.number().int().positive(),
  tags: tagsSchema.optional(),
  bounds: z
    .object({ minlon: z.number(), minlat: z.number(), maxlon: z.number(), maxlat: z.number() })
    .optional(),
  members: z.array(memberSchema).optional()
});
const responseSchema = z.object({
  remark: z.string().optional(),
  osm3s: z.object({ timestamp_osm_base: z.iso.datetime() }),
  elements: z.array(elementSchema)
});
type Relation = z.infer<typeof elementSchema>;
type Bounds = { minLon: number; minLat: number; maxLon: number; maxLat: number };

const fetchOverpass = async (query: string): Promise<unknown> => {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Reissuvihko trail importer'
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`OSM request failed with status ${response.status}.`);
  return response.json();
};
const parseLength = (value: string | undefined, defaultUnit: 'km' | 'm') => {
  if (value === undefined) return null;
  const match = value.match(/^\s*(\d+(?:[.,]\d+)?)\s*(km|m)?\s*$/i);
  if (!match) throw new Error(`Ambiguous length: ${value}`);
  return (
    Number(match[1]!.replace(',', '.')) *
    ((match[2]?.toLowerCase() ?? defaultUnit) === 'm' ? 0.001 : 1)
  );
};
const collect = (
  id: number,
  relations: Map<number, Relation>,
  ancestors = new Set<number>()
): GeoJsonFeature[] => {
  if (ancestors.has(id)) throw new Error(`Cyclic relation ${id}`);
  const relation = relations.get(id);
  if (!relation?.members) throw new Error(`Missing relation ${id}`);
  const next = new Set([...ancestors, id]);
  return relation.members.flatMap((member): GeoJsonFeature[] => {
    if (member.type === 'node') return [];
    if (member.type === 'relation') return collect(member.ref, relations, next);
    if (
      !member.geometry ||
      member.geometry.length < 2 ||
      member.geometry.some((point) => point === null)
    )
      throw new Error(`Missing way geometry ${member.ref}`);
    const coordinates = member.geometry.map(
      (point) => [point!.lon, point!.lat] as GeoJsonCoordinate
    );
    return [{ type: 'Feature', geometry: { type: 'LineString', coordinates } }];
  });
};
export const fetchOsmTrailSnapshot = async ({
  areas,
  fetchSource = fetchOverpass
}: {
  areas?: Bounds[];
  fetchSource?: (query: string) => Promise<unknown>;
} = {}) => {
  const get = async (query: string) => {
    const data = responseSchema.parse(await fetchSource(query));
    if (data.remark) throw new Error(`OSM incomplete response: ${data.remark}`);
    return data;
  };
  const index = await get(
    '[out:json][timeout:45];rel(59.5,19,70.2,32)["type"="route"]["route"~"^(hiking|foot)$"];out tags bb;'
  );
  if (!index.elements.length) throw new Error('OSM returned an empty national index.');
  const roots = index.elements.filter((root) => {
    const tags = root.tags;
    if (
      tags?.type !== 'route' ||
      !['hiking', 'foot'].includes(tags.route ?? '') ||
      !(tags['name:fi'] || tags.name)
    )
      return false;
    if (!areas || !root.bounds) return true;
    const b = root.bounds;
    return areas.some(
      (a) =>
        b.minlon <= a.maxLon && b.maxlon >= a.minLon && b.minlat <= a.maxLat && b.maxlat >= a.minLat
    );
  });
  const ids = new Set(roots.map((r) => r.id));
  if (ids.size !== roots.length) throw new Error('OSM index contains duplicate relation IDs.');
  const relations = new Map<number, Relation>();
  for (let offset = 0; offset < roots.length; offset += batchSize) {
    const batch = roots.slice(offset, offset + batchSize);
    const payload = await get(
      `[out:json][timeout:45];rel(id:${batch.map((r) => r.id).join(',')});(._;>>;);rel._;out geom;`
    );
    for (const relation of payload.elements) relations.set(relation.id, relation);
    if (batch.some((root) => !relations.has(root.id)))
      throw new Error('OSM response omitted requested relations.');
  }
  const rejected: { id: number; name: string; reason: string }[] = [];
  const routes: OsmRoute[] = [];
  for (const root of roots) {
    const tags = root.tags!;
    const name = tags['name:fi'] || tags.name!;
    try {
      const lengths = [parseLength(tags.distance, 'km'), parseLength(tags.length, 'm')].filter(
        (n): n is number => n !== null
      );
      const features = collect(root.id, relations);
      if (!features.length) throw new Error('No way geometry');
      routes.push({
        id: root.id,
        name,
        aliases: [
          ...new Set(
            [tags.name, tags['name:fi'], tags.alt_name]
              .filter((n): n is string => Boolean(n))
              .flatMap((n) =>
                n
                  .split(';')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
          )
        ],
        reportedLengthKm: lengths.length ? Math.max(...lengths) : null,
        geometry: { type: 'FeatureCollection', features }
      });
    } catch (error) {
      rejected.push({
        id: root.id,
        name,
        reason: (error as Error).message
      });
    }
  }
  const snapshot: OsmSnapshot = { timestamp: index.osm3s.timestamp_osm_base, routes };
  return { snapshot, rejected };
};
