// Waldmeister — DB schema (Drizzle). See README §4 for field-level reasoning.
// PostGIS `geometry` columns use WGS84 (EPSG:4326). Drizzle doesn't ship a
// native geometry type, so we define a small helper that writes as text and
// trusts the DB-side cast.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  pgEnum,
  jsonb,
  date,
  customType,
  index,
  primaryKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// --- PostGIS geometry helper ---
// Stored as GeoJSON text on the app side; the DB column is `geometry(...,4326)`.
// On SELECT we cast to GeoJSON with ST_AsGeoJSON; on INSERT we cast with
// ST_GeomFromGeoJSON. The raw schema below declares the column type only —
// the app-side helpers in ./geo.ts handle (de)serialization.
export const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry';
  }
});

// --- Enums ---
export const healthStatusEnum = pgEnum('health_status', ['dead', 'healthy', 'infected', 'must-watch']);
export const treeLabelEnum = pgEnum('tree_label', ['cut-down', 'mark', 'fence', 'prune']);
export const treeTypeEnum = pgEnum('tree_type', [
  'tanne',
  'fichte',
  'kiefer',
  'eiche',
  'buche',
  'laerche',
  'ahorn',
  'esche',
  'birke',
  'sonstige'
]);
export const routeTypeEnum = pgEnum('route_type', ['anfahrt', 'rueckegasse']);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['kleingerät', 'großgerät']);
export const workOrderStatusEnum = pgEnum('work_order_status', ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED']);
export const workOrderTreeStatusEnum = pgEnum('work_order_tree_status', ['OPEN', 'COMPLETED', 'NOT_FOUND', 'PROBLEM']);
export const priorityEnum = pgEnum('priority', ['low', 'normal', 'high', 'urgent']);

// --- Better-auth tables ---
// Better-auth creates its own schema via adapter; we declare compatible tables
// so we can JOIN from application tables. Names match better-auth's defaults.

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow()
});

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
});

export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow()
});

export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow()
});

// --- §4.1 Forest Plots (Waldstück) ---
export const forestPlots = pgTable('forest_plots', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  ownerIdx: index('forest_plots_owner_idx').on(t.ownerId)
}));

// --- §4.2 Parcels (Flurstück) ---
// `parcels` is a **global cache of BayernAtlas ALKIS Flurstücke**, keyed by
// `cadastral_id` (the official Flurstückskennzeichen). One row per real-world
// parcel — independent of which user owns it or whether it's currently
// assigned to any Waldstück. Populated lazily by viewport WFS fetches.
// The `forest_plot_parcels` link table (below) records N:M assignments
// between Waldstücke and these parcels.
export const parcels = pgTable('parcels', {
  id: uuid('id').primaryKey().defaultRandom(),
  cadastralId: text('cadastral_id').notNull().unique(),
  gemarkung: text('gemarkung'),
  municipality: text('municipality'),
  areaSqm: numeric('area_sqm', { precision: 14, scale: 2 }),
  geometry: geometry('geometry').notNull(),
  fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

// --- Waldstück ↔ Flurstück link ---
// N:M mapping. Same Flurstück can belong to many users' Waldstücke; one
// Waldstück holds many Flurstücke. Composite PK prevents the same parcel
// being added to the same plot twice.
export const forestPlotParcels = pgTable('forest_plot_parcels', {
  plotId: uuid('plot_id')
    .notNull()
    .references(() => forestPlots.id, { onDelete: 'cascade' }),
  parcelId: uuid('parcel_id')
    .notNull()
    .references(() => parcels.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (t) => ({
  pk: primaryKey({ columns: [t.plotId, t.parcelId] }),
  parcelIdx: index('forest_plot_parcels_parcel_idx').on(t.parcelId)
}));

// --- §4.3 Access Routes (Anfahrt & Rückegasse) ---
export const accessRoutes = pgTable('access_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  plotId: uuid('plot_id')
    .notNull()
    .references(() => forestPlots.id, { onDelete: 'cascade' }),
  routeType: routeTypeEnum('route_type').notNull().default('anfahrt'),
  name: text('name'),
  pathData: jsonb('path_data').notNull(), // GeoJSON LineString or MultiLineString
  vehicleType: vehicleTypeEnum('vehicle_type').notNull().default('kleingerät'),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  plotIdx: index('access_routes_plot_idx').on(t.plotId)
  // DB-level CHECK: Rückegassen must be Kleingerät. Applied in a migration.
}));

// --- §4.4 Plot Images (Waldstück-Fotos) ---
export const plotImages = pgTable('plot_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  plotId: uuid('plot_id')
    .notNull()
    .references(() => forestPlots.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  name: text('name'),
  sortOrder: integer('sort_order').notNull().default(0),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  gpsAccuracyM: numeric('gps_accuracy_m', { precision: 8, scale: 2 }),
  showOnMap: boolean('show_on_map').notNull().default(false),
  takenAt: timestamp('taken_at').notNull().defaultNow(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  plotIdx: index('plot_images_plot_idx').on(t.plotId)
}));

// --- §4.5 Areas (Bereich) ---
export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  plotId: uuid('plot_id')
    .notNull()
    .references(() => forestPlots.id, { onDelete: 'cascade' }),
  geometry: geometry('geometry').notNull(),
  comment: text('comment'),
  appliedTreeStatus: healthStatusEnum('applied_tree_status'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  plotIdx: index('areas_plot_idx').on(t.plotId)
}));

// --- §4.6 Area Images ---
export const areaImages = pgTable('area_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  areaId: uuid('area_id')
    .notNull()
    .references(() => areas.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  takenAt: timestamp('taken_at').notNull().defaultNow(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  areaIdx: index('area_images_area_idx').on(t.areaId)
}));

// --- §4.7 Trees ---
export const trees = pgTable('trees', {
  id: uuid('id').primaryKey().defaultRandom(),
  plotId: uuid('plot_id')
    .notNull()
    .references(() => forestPlots.id, { onDelete: 'cascade' }),
  parcelId: uuid('parcel_id').references(() => parcels.id, { onDelete: 'set null' }),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  gpsAccuracyM: numeric('gps_accuracy_m', { precision: 8, scale: 2 }),
  healthStatus: healthStatusEnum('health_status').notNull().default('healthy'),
  labels: treeLabelEnum('labels').array().notNull().default(sql`'{}'::tree_label[]`),
  estPlantedAt: date('est_planted_at'),
  treeTypeId: treeTypeEnum('tree_type_id').notNull().default('sonstige'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  plotIdx: index('trees_plot_idx').on(t.plotId),
  parcelIdx: index('trees_parcel_idx').on(t.parcelId)
}));

// --- §4.8 Tree Images ---
export const treeImages = pgTable('tree_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  treeId: uuid('tree_id')
    .notNull()
    .references(() => trees.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  takenAt: timestamp('taken_at').notNull().defaultNow(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (t) => ({
  treeIdx: index('tree_images_tree_idx').on(t.treeId)
}));

// --- §4.9 Work Orders ---
export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shareToken: text('share_token').notNull().unique(),
  shareExpiresAt: timestamp('share_expires_at'),
  title: text('title').notNull(),
  instructions: text('instructions').notNull().default(''),
  workerNotes: text('worker_notes').notNull().default(''),
  status: workOrderStatusEnum('status').notNull().default('OPEN'),
  selectionSnapshot: jsonb('selection_snapshot').notNull(),
  userPriority: priorityEnum('user_priority'),
  shareVisibility: jsonb('share_visibility').notNull().default(sql`'{
    "anfahrten": true,
    "plot_photos": true,
    "areas": true,
    "tree_photos": true,
    "tree_descriptions": false,
    "tree_health": true
  }'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  ownerIdx: index('work_orders_owner_idx').on(t.ownerId),
  tokenIdx: index('work_orders_token_idx').on(t.shareToken)
}));

// --- §4.10 Work Order Trees ---
export const workOrderTrees = pgTable('work_order_trees', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id')
    .notNull()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  treeId: uuid('tree_id')
    .notNull()
    .references(() => trees.id, { onDelete: 'cascade' }),
  status: workOrderTreeStatusEnum('status').notNull().default('OPEN'),
  statusMessage: text('status_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, (t) => ({
  orderIdx: index('work_order_trees_order_idx').on(t.workOrderId),
  treeIdx: index('work_order_trees_tree_idx').on(t.treeId)
}));

// --- Types for app-side use ---
export type User = typeof users.$inferSelect;
export type ForestPlot = typeof forestPlots.$inferSelect;
export type Parcel = typeof parcels.$inferSelect;
export type ForestPlotParcel = typeof forestPlotParcels.$inferSelect;
export type AccessRoute = typeof accessRoutes.$inferSelect;
export type PlotImage = typeof plotImages.$inferSelect;
export type Area = typeof areas.$inferSelect;
export type AreaImage = typeof areaImages.$inferSelect;
export type Tree = typeof trees.$inferSelect;
export type TreeImage = typeof treeImages.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WorkOrderTree = typeof workOrderTrees.$inferSelect;
