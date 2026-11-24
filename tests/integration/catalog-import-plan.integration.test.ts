import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { planCatalogImports } from '../../scripts/catalog-import-plan.js';

it('plans catalog writes by merge scope and reports removals without selecting them', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'catalog-import-plan-'));
  const before = join(workspace, 'before');
  const after = join(workspace, 'after');
  const latest = join(workspace, 'latest');
  const special = 'src/importer/special-parks';
  const linked = 'src/importer/osm-linked-trails.geojson';
  const write = async (root: string, path: string, content: string) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  try {
    const fullCatalog = JSON.parse(await readFile(linked, 'utf8'));
    const [first, second, third] = fullCatalog.selections.slice(0, 3);
    const catalog = (selections: (typeof fullCatalog.selections)[]) =>
      JSON.stringify({
        type: 'FeatureCollection',
        selections,
        features: fullCatalog.features.filter(
          ({ properties }: { properties: { selectionKey: string } }) =>
            selections.some(({ selectionKey }) => selectionKey === properties.selectionKey)
        )
      });
    const config = (parkNames: string[], format: boolean) => {
      const entries = parkNames.map((slug) => ({ slug, sourceUrl: `special://${slug}` }));
      return `export const specialParkConfigs = ${JSON.stringify(entries, null, format ? 2 : 0)};`;
    };
    await write(
      before,
      `${special}/index.ts`,
      config(['unchanged', 'geometry-edit', 'removed'], false)
    );
    await write(
      after,
      `${special}/index.ts`,
      config(['unchanged', 'geometry-edit', 'added'], true)
    );
    await write(before, `${special}/data/unchanged.json`, '{"version":1}');
    await write(after, `${special}/data/unchanged.json`, '{ "version": 1 }');
    await write(before, `${special}/data/geometry-edit.json`, '{"version":1}');
    await write(after, `${special}/data/geometry-edit.json`, '{"version":2}');
    await write(before, `${special}/data/removed.json`, '{}');
    await write(after, `${special}/data/added.json`, '{}');
    await write(before, linked, catalog([first, second, third]));
    await write(after, linked, catalog([third, { ...first, name: 'Edited name' }]));
    await write(after, '.github/osm-trails-refresh', 'Merge request 123\n');

    expect(await planCatalogImports(before, after)).toEqual({
      special: { changed: ['geometry-edit', 'added'], removed: ['removed'], superseded: [] },
      linked: { changed: [first.selectionKey], removed: [second.selectionKey], superseded: [] },
      osm: true
    });
    expect(await planCatalogImports(after, after)).toEqual({
      special: { changed: [], removed: [], superseded: [] },
      linked: { changed: [], removed: [], superseded: [] },
      osm: false
    });

    await write(
      latest,
      `${special}/index.ts`,
      config(['unchanged', 'geometry-edit', 'added'], true)
    );
    await write(latest, `${special}/data/unchanged.json`, '{"version":1}');
    await write(latest, `${special}/data/geometry-edit.json`, '{"version":3}');
    await write(latest, `${special}/data/added.json`, '{}');
    await write(latest, linked, catalog([third, { ...first, name: 'Newer edit' }]));
    await write(latest, '.github/osm-trails-refresh', 'Merge request 124\n');
    expect(await planCatalogImports(before, after, latest)).toEqual({
      special: {
        changed: ['added'],
        removed: ['removed'],
        superseded: ['geometry-edit']
      },
      linked: { changed: [], removed: [second.selectionKey], superseded: [first.selectionKey] },
      osm: false
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
