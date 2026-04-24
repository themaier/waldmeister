-- Turn `parcels` into a global BayernAtlas ALKIS cache and split the per-plot
-- assignment into a dedicated N:M link table.
--
-- Before: parcels(id, plot_id NOT NULL, cadastral_id, geometry, created_at)
--         — each row was a plot ↔ Flurstück link with its own geometry copy.
-- After:  parcels(id, cadastral_id UNIQUE, gemarkung, municipality, area_sqm,
--                 geometry, fetched_at, created_at)
--         — one row per real-world Flurstück, independent of ownership.
--         forest_plot_parcels(plot_id, parcel_id) carries the assignments.
--
-- Pre-launch migration: existing rows are drawn-sketch placeholders (SKETCH-n),
-- not real ALKIS data, so we drop them instead of trying to preserve them.

DELETE FROM "parcels";

ALTER TABLE "parcels" DROP COLUMN IF EXISTS "plot_id";
DROP INDEX IF EXISTS "parcels_plot_idx";

ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "gemarkung" text;
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "municipality" text;
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "area_sqm" numeric(14, 2);
ALTER TABLE "parcels" ADD COLUMN IF NOT EXISTS "fetched_at" timestamp NOT NULL DEFAULT now();

ALTER TABLE "parcels" ADD CONSTRAINT "parcels_cadastral_id_unique" UNIQUE ("cadastral_id");

CREATE INDEX IF NOT EXISTS "parcels_geom_gix" ON "parcels" USING GIST ("geometry");

CREATE TABLE IF NOT EXISTS "forest_plot_parcels" (
  "plot_id"    uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
  "parcel_id"  uuid NOT NULL REFERENCES "parcels"("id")       ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("plot_id", "parcel_id")
);

CREATE INDEX IF NOT EXISTS "forest_plot_parcels_parcel_idx"
  ON "forest_plot_parcels" ("parcel_id");
