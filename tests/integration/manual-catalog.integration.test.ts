import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getParkBySlug, listParks } from "../../src/db/repositories.js";
import { parks } from "../../src/db/schema.js";
import { importParks } from "../../src/importer/import-parks.js";
import { importSpecialParks } from "../../src/importer/import-special-parks.js";
import { createLipasPark } from "../fixtures/lipas.js";
import { createSpecialParksSource } from "../fixtures/special-parks.js";
import { createTestDatabase } from "../helpers/test-db.js";

const merenkurkkuSourceUrl =
  "https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326";

const kevoSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'";

const laajalahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Laajalahden luonnonsuojelualue'";

const liminganlahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Liminganlahden luonnonsuojelualue'";

const mallaSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Mallan luonnonpuisto'";

const siikalahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Siikalahden luonnonsuojelualue'";

const createPolygonFeature = (
  coordinates: number[][][],
  properties: Record<string, unknown> = {},
) => ({
  geometry: { coordinates, type: "Polygon" },
  properties,
  type: "Feature",
});

describe("manual catalog imports", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await testDatabase.dispose();
  });

  it("imports all special parks with correct metadata", async () => {
    const result = await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => "2026-05-27T08:00:00.000Z",
    });

    expect(result.results).toHaveLength(6);

    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      "merenkurkun-maailmanperintoalue",
    );
    expect(merenkurkku).toMatchObject({
      displayTypeName: "Maailmanperintökohde",
      lipasId: 9000898,
      name: "Merenkurkun maailmanperintöalue",
      type: { slug: "other-nature-reserve" },
    });
    const rawMerenkurkku = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, "merenkurkun-maailmanperintoalue"),
    });
    expect(rawMerenkurkku).toMatchObject({
      managedByLipasImport: false,
      postalCode: "65800",
      postalOffice: "Raippaluoto",
    });

    const kevo = await getParkBySlug(testDatabase.database, "kevon-luonnonpuisto");
    expect(kevo).toMatchObject({
      displayTypeName: "Luonnonpuisto",
      lipasId: 9000915,
      name: "Kevon luonnonpuisto",
      type: { slug: "other-nature-reserve" },
    });
    expect(rawMerenkurkku).toMatchObject({ managedByLipasImport: false });

    const laajalahti = await getParkBySlug(testDatabase.database, "laajalahden-luonnonsuojelualue");
    expect(laajalahti).toMatchObject({
      lipasId: 9000824,
      name: "Laajalahden luonnonsuojelualue",
      type: { slug: "other-nature-reserve" },
    });

    const liminganlahti = await getParkBySlug(testDatabase.database, "liminganlahti");
    expect(liminganlahti).toMatchObject({
      displayTypeName: "Lintuvesi",
      lipasId: 900070433,
      name: "Liminganlahti",
      type: { slug: "other-nature-reserve" },
    });

    const malla = await getParkBySlug(testDatabase.database, "mallan-luonnonpuisto");
    expect(malla).toMatchObject({
      displayTypeName: "Luonnonpuisto",
      lipasId: 900042160,
      name: "Mallan luonnonpuisto",
      type: { slug: "other-nature-reserve" },
    });

    const siikalahti = await getParkBySlug(testDatabase.database, "siikalahden-luonnonsuojelualue");
    expect(siikalahti).toMatchObject({
      lipasId: 9000102829,
      name: "Siikalahden luonnonsuojelualue",
      type: { slug: "other-nature-reserve" },
    });
  });

  it("keeps non-LIPAS-managed parks active when a later LIPAS import deactivates managed rows", async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => "2026-05-27T08:00:00.000Z",
    });

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => "2026-05-28T08:00:00.000Z",
      sourceUrl: "https://example.test/lipas",
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: "incorrect-data",
          }),
        ],
      }),
    });

    const allParks = await listParks(testDatabase.database);
    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      "merenkurkun-maailmanperintoalue",
    );
    const kevo = await getParkBySlug(testDatabase.database, "kevon-luonnonpuisto");

    expect(allParks).toHaveLength(6);
    expect(merenkurkku).toMatchObject({ catalogStatus: "active" });
    expect(kevo).toMatchObject({ catalogStatus: "active" });
  });

  it("fails loudly when a source fetch returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(
      importSpecialParks({
        database: testDatabase.database,
      }),
    ).rejects.toThrow("Special parks import failed with status 503");
  });

  it("fails when a source payload has no matching features", async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === kevoSourceUrl) {
            return { type: "FeatureCollection", features: [] };
          }

          return createSpecialParksSource()(sourceUrl);
        },
      }),
    ).rejects.toThrow("No features found for Kevon luonnonpuisto in the SYKE source.");
  });

  it("supports the default fetch path used by the CLI importer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === merenkurkkuSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [21.0, 63.0],
                      [21.0, 63.2],
                      [21.2, 63.2],
                      [21.2, 63.0],
                      [21.0, 63.0],
                    ],
                  ],
                  {
                    ID: 898,
                    Nimi: "Merenkurkun saaristo",
                    URL: "https://example.test/merenkurkku",
                    aluetyyppi: "Kohde",
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        if (url === kevoSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [27.0, 69.5],
                      [27.0, 69.7],
                      [27.3, 69.7],
                      [27.3, 69.5],
                      [27.0, 69.5],
                    ],
                  ],
                  {
                    nimi: "Kevon luonnonpuisto",
                    paatpvm: "1956-12-21T00:00:00Z",
                    shape_area: 710_648_647,
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        if (url === laajalahtiSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [24.8, 60.2],
                      [24.8, 60.22],
                      [24.85, 60.22],
                      [24.85, 60.2],
                      [24.8, 60.2],
                    ],
                  ],
                  {
                    ely: "Uudenmaan ELY-keskus",
                    nimi: "Laajalahden luonnonsuojelualue",
                    paatpvm: "1989-11-10T00:00:00Z",
                    shape_area: 1_894_414,
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        if (url === liminganlahtiSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [25.2, 64.8],
                      [25.2, 64.82],
                      [25.25, 64.82],
                      [25.25, 64.8],
                      [25.2, 64.8],
                    ],
                  ],
                  {
                    nimi: "Liminganlahden luonnonsuojelualue",
                    paatpvm: "1998-11-25T00:00:00Z",
                    shape_area: 23_784,
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        if (url === mallaSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [20.7, 69.0],
                      [20.7, 69.05],
                      [20.8, 69.05],
                      [20.8, 69.0],
                      [20.7, 69.0],
                    ],
                  ],
                  {
                    nimi: "Mallan luonnonpuisto",
                    paatpvm: "1938-02-18T00:00:00Z",
                    shape_area: 30_796_806,
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        if (url === siikalahtiSourceUrl) {
          return {
            json: async () => ({
              type: "FeatureCollection",
              features: [
                createPolygonFeature(
                  [
                    [
                      [29.3, 61.5],
                      [29.3, 61.55],
                      [29.4, 61.55],
                      [29.4, 61.5],
                      [29.3, 61.5],
                    ],
                  ],
                  {
                    nimi: "Siikalahden luonnonsuojelualue",
                    paatpvm: "2019-11-14T00:00:00Z",
                    shape_area: 4_469_391,
                  },
                ),
              ],
            }),
            ok: true,
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      }),
    );

    const result = await importSpecialParks({
      database: testDatabase.database,
    });

    expect(result.results).toHaveLength(6);

    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      "merenkurkun-maailmanperintoalue",
    );
    expect(merenkurkku).toMatchObject({
      displayTypeName: "Maailmanperintökohde",
      name: "Merenkurkun maailmanperintöalue",
    });
  });

  it("derives area and establishment year from SYKE features", async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => "2026-05-27T08:00:00.000Z",
    });

    const kevo = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, "kevon-luonnonpuisto"),
    });

    expect(kevo?.areaKm2).toBe(710.65);
    expect(kevo?.establishmentYear).toBe(1956);

    const liminganlahti = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, "liminganlahti"),
    });

    expect(liminganlahti?.areaKm2).toBe(3.7);
    expect(liminganlahti?.establishmentYear).toBe(1998);
  });

  it("filters Laajalahti by ELY to pick the Espoo feature", async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => "2026-05-27T08:00:00.000Z",
    });

    const laajalahti = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, "laajalahden-luonnonsuojelualue"),
    });

    expect(laajalahti?.areaKm2).toBe(1.89);
    expect(laajalahti?.establishmentYear).toBe(1989);
  });

  it("fails when Merenkurkku source has no matching features", async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === merenkurkkuSourceUrl) {
            return { type: "FeatureCollection", features: [] };
          }

          return createSpecialParksSource()(sourceUrl);
        },
      }),
    ).rejects.toThrow("No Merenkurkku world heritage area features were found in the source.");
  });

  it("handles MultiPolygon geometries from SYKE", async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl === kevoSourceUrl) {
          return {
            type: "FeatureCollection",
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [
                        [27.0, 69.5],
                        [27.0, 69.7],
                        [27.3, 69.7],
                        [27.3, 69.5],
                        [27.0, 69.5],
                      ],
                    ],
                    [
                      [
                        [27.4, 69.5],
                        [27.4, 69.6],
                        [27.5, 69.6],
                        [27.5, 69.5],
                        [27.4, 69.5],
                      ],
                    ],
                  ],
                  type: "MultiPolygon",
                },
                properties: {
                  nimi: "Kevon luonnonpuisto",
                  paatpvm: "1956-12-21T00:00:00Z",
                  shape_area: 710_648_647,
                },
                type: "Feature",
              },
            ],
          };
        }

        return createSpecialParksSource()(sourceUrl);
      },
    });

    const kevo = await getParkBySlug(testDatabase.database, "kevon-luonnonpuisto");
    const boundaryFeatures = (kevo?.boundaryGeoJson as { features: unknown[] } | undefined)
      ?.features;

    expect(boundaryFeatures).toHaveLength(2);
  });

  it("handles missing SYKE metadata fields gracefully", async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl === kevoSourceUrl) {
          return {
            type: "FeatureCollection",
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [
                        [27.0, 69.5],
                        [27.0, 69.7],
                        [27.3, 69.7],
                        [27.3, 69.5],
                        [27.0, 69.5],
                      ],
                    ],
                  ],
                  type: "MultiPolygon",
                },
                properties: { nimi: "Kevon luonnonpuisto" },
                type: "Feature",
              },
            ],
          };
        }

        return createSpecialParksSource()(sourceUrl);
      },
    });

    const kevo = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, "kevon-luonnonpuisto"),
    });

    expect(kevo?.areaKm2).toBeNull();
    expect(kevo?.establishmentYear).toBeNull();
  });
});
