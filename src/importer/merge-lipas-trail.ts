import { eq, inArray, sql } from 'drizzle-orm';
import type { DbClient } from '../db/database.js';
import {
  parks,
  parkVisits,
  trailAreaLinks,
  trailMergeGroups,
  trailMergeMembers,
  visitTrails
} from '../db/schema.js';
import {
  bumpMergedTrailVersion,
  combineTrailGeometry,
  mergedTrailSlugs
} from '../db/trail-merges.js';
import { isTrailTypeCode } from '../parks/park-types.js';
import type { MappedPark } from './map-lipas-park.js';
import { seitsemansVeljestaTrail as definition } from './seitsemans-veljesta-trail.js';

type LipasTrailMergePlan = {
  components: MappedPark[];
  combined: ReturnType<typeof combineTrailGeometry>;
};

export const prepareLipasTrailMerge = (
  source: Map<number, MappedPark>
): LipasTrailMergePlan | { error: string } | undefined => {
  const components = definition.componentIds.flatMap((id) => {
    const component = source.get(id);
    return component && isTrailTypeCode(component.type.code) ? [component] : [];
  });
  if (components.length !== definition.componentIds.length) return undefined;
  try {
    return {
      components,
      combined: combineTrailGeometry(
        components.map((component) => JSON.stringify(component.boundaryGeoJson)),
        { allowLong: true }
      )
    };
  } catch (error) {
    return { error: String(error) };
  }
};

export const getLipasTrailMergeState = async (database: DbClient) => {
  const [state] = await database
    .select({ canonical: parks, group: trailMergeGroups })
    .from(parks)
    .leftJoin(trailMergeGroups, eq(trailMergeGroups.trailId, parks.id))
    .where(eq(parks.lipasId, definition.canonicalId));
  return state;
};

export const applyLipasTrailMerge = async (
  database: DbClient,
  plan: LipasTrailMergePlan,
  previous: Awaited<ReturnType<typeof getLipasTrailMergeState>>,
  timestamp: string
) => {
  const rows = await database
    .select({ id: parks.id, lipasId: parks.lipasId, slug: parks.slug, removed: parks.removed })
    .from(parks)
    .where(inArray(parks.lipasId, definition.componentIds));
  const canonical = rows.find((row) => row.lipasId === definition.canonicalId)!;
  const absorbed = rows.filter((row) => row.id !== canonical.id);
  const absorbedIds = absorbed.map((row) => row.id);
  let needsImmediateExpiry = false;

  if (!previous?.group) {
    const directVisits = await database
      .select({ id: parkVisits.id })
      .from(parkVisits)
      .where(inArray(parkVisits.parkId, absorbedIds))
      .limit(1);
    if (directVisits.length)
      throw new Error(
        `Review direct visits on the six source trails before merging ${canonical.slug}.`
      );

    const areaLinks = await database
      .select({
        link: trailAreaLinks,
        areaSlug: parks.slug,
        publicMembership: sql<number>`${parks.catalogStatus} = 'active'
          and ${parks.removed} = 0
          and (${trailAreaLinks.override} = 'include'
            or (${trailAreaLinks.automaticMatch} = 1 and ${trailAreaLinks.override} is null))`
      })
      .from(trailAreaLinks)
      .innerJoin(parks, eq(parks.id, trailAreaLinks.areaId))
      .where(
        inArray(
          trailAreaLinks.trailId,
          rows.map((row) => row.id)
        )
      );
    const links = areaLinks.map(({ link }) => link);
    needsImmediateExpiry =
      absorbed.some((row) => !row.removed) ||
      areaLinks.some(({ publicMembership }) => publicMembership === 1);
    const pins = new Set(
      links
        .filter((row) => row.trailId !== canonical.id && row.override === 'include')
        .map((row) => row.areaId)
    );
    const conflicts = areaLinks
      .filter(
        ({ link }) =>
          link.trailId === canonical.id && link.override === 'exclude' && pins.has(link.areaId)
      )
      .map(({ areaSlug }) => areaSlug)
      .sort();
    if (conflicts.length) {
      const actions = conflicts.map(
        (slug) =>
          `In the admin UI, open Reitit → Alueen reitit for ${slug} and search for ${definition.name}. Use Lisää and confirm the slug is ${canonical.slug}.`
      );
      throw new Error(
        [
          `Cannot merge ${canonical.slug}. The surviving trail is excluded from an area that includes one of its source trails.`,
          ...actions,
          'Keep the existing source trail assignments on visits. Then retry npm run import:parks -- --dry-run.'
        ].join('\n')
      );
    }
    for (const areaId of pins) {
      await database
        .insert(trailAreaLinks)
        .values({
          trailId: canonical.id,
          areaId,
          override: 'include',
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: [trailAreaLinks.trailId, trailAreaLinks.areaId],
          set: { override: 'include', updatedAt: timestamp }
        });
    }

    const assignments = await database
      .select({ visitId: visitTrails.visitId })
      .from(visitTrails)
      .where(inArray(visitTrails.trailId, absorbedIds));
    if (assignments.length) {
      await database
        .insert(visitTrails)
        .values(assignments.map(({ visitId }) => ({ visitId, trailId: canonical.id })))
        .onConflictDoNothing();
      await database.delete(visitTrails).where(inArray(visitTrails.trailId, absorbedIds));
    }
    await database.update(parks).set({ removed: true }).where(inArray(parks.id, absorbedIds));
  }

  const length = plan.combined.lengthKm;
  await database
    .insert(trailMergeGroups)
    .values({ trailId: canonical.id, measuredLengthKm: length, createdAt: timestamp })
    .onConflictDoUpdate({
      target: trailMergeGroups.trailId,
      set: { measuredLengthKm: length }
    });
  for (const component of plan.components) {
    const trailId = rows.find((row) => row.lipasId === component.lipasId)!.id;
    const snapshot = {
      sourceGeometry: JSON.stringify(component.boundaryGeoJson),
      sourceLengthKm: component.lengthKm,
      sourceTimestamp: component.sourceEventDate ?? timestamp
    };
    await database
      .insert(trailMergeMembers)
      .values({ ...snapshot, trailId, canonicalTrailId: canonical.id })
      .onConflictDoUpdate({ target: trailMergeMembers.trailId, set: snapshot });
  }

  const changed =
    !previous?.group || previous.canonical.boundaryGeojson !== plan.combined.boundaryGeojson;
  if (changed) await bumpMergedTrailVersion(database, timestamp);
  return {
    canonicalId: canonical.id,
    needsImmediateExpiry,
    affectedSlugs: changed
      ? await mergedTrailSlugs(
          database,
          rows.map((row) => row.id)
        )
      : []
  };
};
