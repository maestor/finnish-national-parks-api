import { createDatabaseClient } from '../db/client.js';

type DuplicateImageIdentity = {
  displayOrders: string;
  fullKey: string;
  imageIds: string;
  parentId: number;
  referenceCount: number;
  rowCount: number;
  type: 'trip-stop' | 'visit';
};

const collectDuplicates = async (): Promise<DuplicateImageIdentity[]> => {
  const client = createDatabaseClient();

  try {
    const [visitRows, tripStopRows] = await Promise.all([
      client.execute(`
        SELECT
          visit_id AS parent_id,
          full_key,
          GROUP_CONCAT(id) AS image_ids,
          GROUP_CONCAT(display_order) AS display_orders,
          COUNT(*) AS row_count,
          SUM(
            EXISTS(
              SELECT 1 FROM trip_featured_images
              WHERE trip_featured_images.visit_image_id = visit_images.id
            )
          ) AS reference_count
        FROM visit_images
        GROUP BY visit_id, full_key
        HAVING COUNT(*) > 1
        ORDER BY visit_id, full_key
      `),
      client.execute(`
        SELECT
          trip_stop_id AS parent_id,
          full_key,
          GROUP_CONCAT(id) AS image_ids,
          GROUP_CONCAT(display_order) AS display_orders,
          COUNT(*) AS row_count,
          SUM(
            EXISTS(
              SELECT 1 FROM trip_featured_images
              WHERE trip_featured_images.trip_stop_image_id = trip_stop_images.id
            )
          ) AS reference_count
        FROM trip_stop_images
        GROUP BY trip_stop_id, full_key
        HAVING COUNT(*) > 1
        ORDER BY trip_stop_id, full_key
      `)
    ]);

    return [
      ...visitRows.rows.map((row) => ({
        displayOrders: String(row.display_orders),
        fullKey: String(row.full_key),
        imageIds: String(row.image_ids),
        parentId: Number(row.parent_id),
        referenceCount: Number(row.reference_count),
        rowCount: Number(row.row_count),
        type: 'visit' as const
      })),
      ...tripStopRows.rows.map((row) => ({
        displayOrders: String(row.display_orders),
        fullKey: String(row.full_key),
        imageIds: String(row.image_ids),
        parentId: Number(row.parent_id),
        referenceCount: Number(row.reference_count),
        rowCount: Number(row.row_count),
        type: 'trip-stop' as const
      }))
    ];
  } finally {
    await client.close();
  }
};

const duplicates = await collectDuplicates();

if (duplicates.length === 0) {
  console.log('No duplicate image completion identities found.');
} else {
  console.error('Duplicate image completion identities need operator repair before migration:');

  for (const duplicate of duplicates) {
    console.error(
      JSON.stringify({
        ...duplicate,
        note: 'Preserve display order and featured-image references when resolving this group; this command made no changes.'
      })
    );
  }

  process.exitCode = 1;
}
