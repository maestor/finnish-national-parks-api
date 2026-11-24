import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseSelectedTrails } from '../src/importer/import-selected-trails.js';
import type { SpecialParkConfig } from '../src/importer/special-parks/types.js';

const specialPath = 'src/importer/special-parks';
const linkedPath = 'src/importer/osm-linked-trails.geojson';
const osmRequestPath = '.github/osm-trails-refresh';

const readOptional = async (path: string) => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
};

const readSpecialParks = async (root: string) => {
  const { specialParkConfigs } = (await import(
    pathToFileURL(join(root, specialPath, 'index.ts')).href
  )) as { specialParkConfigs: SpecialParkConfig[] };
  const entries = await Promise.all(
    specialParkConfigs.map(async ({ slug, extractMetadata, filterFeatures, ...config }) => {
      const localSource = config.sourceUrl.startsWith('special://')
        ? await readFile(
            join(root, specialPath, 'data', `${config.sourceUrl.slice('special://'.length)}.json`),
            'utf8'
          )
        : undefined;
      return [
        slug,
        {
          ...config,
          extractMetadata: extractMetadata?.toString(),
          filterFeatures: filterFeatures?.toString(),
          localSource: localSource === undefined ? undefined : JSON.parse(localSource)
        }
      ] as const;
    })
  );
  return new Map(entries);
};

const readLinkedTrails = async (root: string) => {
  const { selections } = parseSelectedTrails(await readFile(join(root, linkedPath), 'utf8'));
  return new Map(selections.map((item) => [item.selection.selectionKey, item]));
};

const readCatalogInputs = async (root: string) => {
  const [special, linked, osm] = await Promise.all([
    readSpecialParks(root),
    readLinkedTrails(root),
    readOptional(join(root, osmRequestPath))
  ]);
  return { special, linked, osm };
};

const compare = (
  before: Map<string, unknown>,
  after: Map<string, unknown>,
  latest: Map<string, unknown>
) => {
  const changed = [...after.keys()].filter(
    (key) => !isDeepStrictEqual(before.get(key), after.get(key))
  );
  const superseded = changed.filter((key) => !isDeepStrictEqual(after.get(key), latest.get(key)));
  const supersededKeys = new Set(superseded);
  return {
    changed: changed.filter((key) => !supersededKeys.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    superseded
  };
};

export const planCatalogImports = async (before: string, after: string, latest = after) => {
  const [previous, merged, current] = await Promise.all([
    readCatalogInputs(before),
    readCatalogInputs(after),
    readCatalogInputs(latest)
  ]);
  return {
    special: compare(previous.special, merged.special, current.special),
    linked: compare(previous.linked, merged.linked, current.linked),
    osm: Boolean(merged.osm?.trim() && merged.osm !== previous.osm && merged.osm === current.osm)
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [before, after, latest = after] = process.argv.slice(2);
  if (!before || !after || !latest)
    throw new Error('Usage: catalog-import-plan <before-dir> <after-dir> [latest-dir]');
  process.stdout.write(
    `${JSON.stringify(await planCatalogImports(resolve(before), resolve(after), resolve(latest)))}\n`
  );
}
