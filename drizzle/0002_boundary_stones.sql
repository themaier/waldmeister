-- Grenzsteine — one photo per boundary stone, description, optional GPS.
CREATE TABLE IF NOT EXISTS "boundary_stones" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plot_id"        uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
  "s3_key"         text NOT NULL,
  "description"    text NOT NULL DEFAULT '',
  "latitude"       numeric(10, 7),
  "longitude"      numeric(10, 7),
  "gps_accuracy_m" numeric(8, 2),
  "width_px"       integer NOT NULL,
  "height_px"      integer NOT NULL,
  "taken_at"       timestamp NOT NULL DEFAULT now(),
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "boundary_stones_plot_idx"
  ON "boundary_stones" ("plot_id");
