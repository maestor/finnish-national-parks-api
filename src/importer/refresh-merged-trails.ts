import { asc, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../db/database.js';
import {
  osmTrailSources,
  parks,
  trailAreaLinks,
  trailMergeGroups,
  trailMergeMembers
} from '../db/schema.js';
import {
  applyMergedMemberships,
  combineTrailGeometry,
  mergedTrailSlugs,
  planMergedMemberships
} from '../db/trail-merges.js';
import type { OsmRoute, OsmSnapshot } from './import-osm-trails.js';
import { exceedsTrailLengthLimit } from './trail-area-geometry.js';

export const prepareMergedTrailRefresh = async (database: DbClient, snapshot: OsmSnapshot) => {
  const members = await database
    .select()
    .from(trailMergeMembers)
    .orderBy(asc(trailMergeMembers.trailId));
  const groups = await database
    .select()
    .from(trailMergeGroups)
    .orderBy(asc(trailMergeGroups.trailId));
  const warnings: string[] = [];
  const plans = [];
  for (const group of groups) {
    const current = members.filter((m) => m.canonicalTrailId === group.trailId);
    const canonical = (await database.select().from(parks).where(eq(parks.id, group.trailId)))[0]!;
    const sources = await database
      .select()
      .from(osmTrailSources)
      .where(
        inArray(
          osmTrailSources.trailId,
          current.map((m) => m.trailId)
        )
      );
    const updates: { member: typeof trailMergeMembers.$inferSelect; route: OsmRoute }[] = [];
    for (const member of current) {
      const source = sources.find((s) => s.trailId === member.trailId)!;
      const route = snapshot.routes.find((r) => r.id === source.relationId);
      if (!route) {
        warnings.push(
          `${canonical.slug}: OSM ${source.relationId} missing; retaining last valid component.`
        );
        continue;
      }
      try {
        combineTrailGeometry([JSON.stringify(route.geometry)]);
        if (exceedsTrailLengthLimit(null, route.reportedLengthKm))
          throw new Error('Reported source length exceeds 100 km.');
      } catch (error) {
        warnings.push(
          `${canonical.slug}: OSM ${source.relationId} rejected; retaining last valid component. ${String(error)}`
        );
        continue;
      }
      const next = {
        ...member,
        sourceGeometry: JSON.stringify(route.geometry),
        sourceLengthKm: route.reportedLengthKm,
        sourceTimestamp: snapshot.timestamp
      };
      if (
        next.sourceGeometry !== member.sourceGeometry ||
        next.sourceLengthKm !== member.sourceLengthKm ||
        next.sourceTimestamp !== member.sourceTimestamp
      )
        updates.push({ member: next, route });
    }
    if (!updates.length) continue;
    const combined = combineTrailGeometry(
      current.map(
        (m) =>
          updates.find((u) => u.member.trailId === m.trailId)?.member.sourceGeometry ??
          m.sourceGeometry
      )
    );
    const lengthKm =
      canonical.lengthKm === group.measuredLengthKm ? combined.lengthKm : canonical.lengthKm;
    if (exceedsTrailLengthLimit(null, lengthKm))
      throw new Error(`Merged trail ${canonical.slug} exceeds the 100 km length limit.`);
    const links = await database
      .select()
      .from(trailAreaLinks)
      .where(eq(trailAreaLinks.trailId, canonical.id));
    const membershipPlan = await planMergedMemberships(
      database,
      canonical.id,
      combined.geometry,
      []
    );
    plans.push({
      membershipPlan,
      canonical,
      group,
      current,
      links,
      updates,
      combined,
      lengthKm,
      affectedSlugs: [
        ...new Set([
          ...(await mergedTrailSlugs(
            database,
            current.map((m) => m.trailId)
          )),
          ...membershipPlan.map((m) => m.areaSlug)
        ])
      ]
    });
  }
  return { memberIds: members.map((m) => m.trailId), plans, warnings };
};

export const applyMergedTrailRefresh = async (
  database: DbClient,
  prepared: Awaited<ReturnType<typeof prepareMergedTrailRefresh>>,
  timestamp: string
) => {
  for (const plan of prepared.plans) {
    for (const { member, route } of plan.updates) {
      await database
        .update(trailMergeMembers)
        .set(member)
        .where(eq(trailMergeMembers.trailId, member.trailId));
      await database
        .update(osmTrailSources)
        .set({ sourceTimestamp: member.sourceTimestamp })
        .where(eq(osmTrailSources.trailId, member.trailId));
      // The canonical row stores effective geometry; its raw input lives in the member snapshot.
      if (member.trailId !== plan.canonical.id) {
        await database
          .update(parks)
          .set({
            boundaryGeojson: member.sourceGeometry,
            importedName: route.name,
            importedLengthKm: route.reportedLengthKm,
            updatedAt: timestamp
          })
          .where(eq(parks.id, member.trailId));
      }
    }
    const { geometry: _geometry, lengthKm: _measuredLength, ...geometryValues } = plan.combined;
    await database
      .update(parks)
      .set({ ...geometryValues, lengthKm: plan.lengthKm, updatedAt: timestamp })
      .where(eq(parks.id, plan.canonical.id));
    await database
      .update(trailMergeGroups)
      .set({ measuredLengthKm: plan.combined.lengthKm })
      .where(eq(trailMergeGroups.trailId, plan.canonical.id));
    await applyMergedMemberships(database, plan.canonical.id, plan.membershipPlan, timestamp);
  }
};
