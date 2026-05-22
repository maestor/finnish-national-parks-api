import { describe, expect, it } from 'vitest';

import { createLuontoonUrlResolver } from '../../src/importer/luontoon-sitemap.js';

describe('createLuontoonUrlResolver', () => {
  it('resolves base destination urls by lipas id and slug', () => {
    const resolveLuontoonUrl = createLuontoonUrlResolver(`
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://www.luontoon.fi/fi/kohteet/aittovuoren-ulkoilualue-jyvaskyla-72648</loc>
        </url>
        <url>
          <loc>https://www.luontoon.fi/fi/kohteet/langinkosken-luonnonsuojelualue</loc>
        </url>
      </urlset>
    `);

    expect(
      resolveLuontoonUrl({
        lipasId: 72648,
        slug: 'aittovuoren-ulkoilualue'
      })
    ).toBe('https://www.luontoon.fi/fi/kohteet/aittovuoren-ulkoilualue-jyvaskyla-72648');
    expect(
      resolveLuontoonUrl({
        lipasId: 99999,
        slug: 'langinkosken-luonnonsuojelualue'
      })
    ).toBe('https://www.luontoon.fi/fi/kohteet/langinkosken-luonnonsuojelualue');
  });

  it('ignores non-destination urls and returns null when no match exists', () => {
    const resolveLuontoonUrl = createLuontoonUrlResolver(`
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://www.luontoon.fi/fi/kohteet/aittovuoren-ulkoilualue-jyvaskyla-72648/reitit</loc>
        </url>
        <url>
          <loc>https://www.luontoon.fi/en/destinations/aittovuoren-ulkoilualue-jyvaskyla-72648-en</loc>
        </url>
        <url>
          <loc>https://www.luontoon.fi/fi/reitit/aittovuoren-polku-jyvaskyla-509883</loc>
        </url>
      </urlset>
    `);

    expect(
      resolveLuontoonUrl({
        lipasId: 72648,
        slug: 'aittovuoren-ulkoilualue'
      })
    ).toBeNull();
  });
});
