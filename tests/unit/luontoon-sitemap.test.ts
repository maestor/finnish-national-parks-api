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
          <loc>https://www.luontoon.fi/fi/ajankohtaista/jokin-artikkeli-72648</loc>
        </url>
        <url>
          <loc>https://www.luontoon.fi/fi</loc>
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

  it('resolves official route urls for nature trails by lipas id', () => {
    const resolveLuontoonUrl = createLuontoonUrlResolver(`
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://www.luontoon.fi/fi/reitit/finnoon-luontopolku-espoo-527072</loc>
        </url>
        <url>
          <loc>https://www.luontoon.fi/fi/kohteet/finnoonlahti-espoo-123456/reitit</loc>
        </url>
      </urlset>
    `);

    expect(
      resolveLuontoonUrl({
        lipasId: 527072,
        slug: 'finnoon-luontopolku'
      })
    ).toBe('https://www.luontoon.fi/fi/reitit/finnoon-luontopolku-espoo-527072');
  });
});
