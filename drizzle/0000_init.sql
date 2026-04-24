-- Waldmeister initial schema.
-- Requires PostGIS. The postgis/postgis Docker image preloads the extension.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Enums =====
DO $$ BEGIN
	CREATE TYPE "health_status" AS ENUM ('dead', 'healthy', 'infected', 'must-watch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "tree_label" AS ENUM ('cut-down', 'mark', 'fence', 'prune');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "tree_type" AS ENUM ('tanne','fichte','kiefer','eiche','buche','laerche','ahorn','esche','birke','sonstige');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "route_type" AS ENUM ('anfahrt','rueckegasse');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "vehicle_type" AS ENUM ('kleingerät','großgerät');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "work_order_status" AS ENUM ('OPEN','IN_PROGRESS','COMPLETED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "work_order_tree_status" AS ENUM ('OPEN','COMPLETED','NOT_FOUND','PROBLEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "priority" AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== Better-auth tables =====
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean NOT NULL DEFAULT false,
	"image" text,
	"createdAt" timestamp NOT NULL DEFAULT now(),
	"updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"createdAt" timestamp NOT NULL DEFAULT now(),
	"updatedAt" timestamp NOT NULL DEFAULT now(),
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL DEFAULT now(),
	"updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL DEFAULT now(),
	"updatedAt" timestamp NOT NULL DEFAULT now()
);

-- ===== Forest Plots (Waldstück) =====
CREATE TABLE IF NOT EXISTS "forest_plots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"name" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "forest_plots_owner_idx" ON "forest_plots"("owner_id");

-- ===== Parcels (Flurstück) =====
CREATE TABLE IF NOT EXISTS "parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plot_id" uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
	"cadastral_id" text NOT NULL,
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "parcels_plot_idx" ON "parcels"("plot_id");
CREATE INDEX IF NOT EXISTS "parcels_geom_idx" ON "parcels" USING GIST ("geometry");

-- ===== Access Routes (Anfahrt & Rückegasse) =====
CREATE TABLE IF NOT EXISTS "access_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plot_id" uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
	"route_type" "route_type" NOT NULL DEFAULT 'anfahrt',
	"name" text,
	"path_data" jsonb NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL DEFAULT 'kleingerät',
	"comment" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	-- Rückegassen are always Kleingerät (README §4.3).
	CONSTRAINT "access_routes_rueckegasse_kleingeraet" CHECK (
		route_type <> 'rueckegasse' OR vehicle_type = 'kleingerät'
	)
);
CREATE INDEX IF NOT EXISTS "access_routes_plot_idx" ON "access_routes"("plot_id");

-- ===== Plot Images (Waldstück-Fotos) =====
CREATE TABLE IF NOT EXISTS "plot_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plot_id" uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
	"s3_key" text NOT NULL,
	"name" text,
	"sort_order" integer NOT NULL DEFAULT 0,
	"latitude" numeric(10,7),
	"longitude" numeric(10,7),
	"gps_accuracy_m" numeric(8,2),
	"show_on_map" boolean NOT NULL DEFAULT false,
	"taken_at" timestamp NOT NULL DEFAULT now(),
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "plot_images_plot_idx" ON "plot_images"("plot_id");

-- ===== Areas (Bereich) =====
CREATE TABLE IF NOT EXISTS "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plot_id" uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"comment" text,
	"applied_tree_status" "health_status",
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "areas_plot_idx" ON "areas"("plot_id");
CREATE INDEX IF NOT EXISTS "areas_geom_idx" ON "areas" USING GIST ("geometry");

-- ===== Area Images =====
CREATE TABLE IF NOT EXISTS "area_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"area_id" uuid NOT NULL REFERENCES "areas"("id") ON DELETE CASCADE,
	"s3_key" text NOT NULL,
	"sort_order" integer NOT NULL DEFAULT 0,
	"taken_at" timestamp NOT NULL DEFAULT now(),
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "area_images_area_idx" ON "area_images"("area_id");

-- ===== Trees =====
CREATE TABLE IF NOT EXISTS "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plot_id" uuid NOT NULL REFERENCES "forest_plots"("id") ON DELETE CASCADE,
	"parcel_id" uuid REFERENCES "parcels"("id") ON DELETE SET NULL,
	"latitude" numeric(10,7) NOT NULL,
	"longitude" numeric(10,7) NOT NULL,
	"gps_accuracy_m" numeric(8,2),
	"health_status" "health_status" NOT NULL DEFAULT 'healthy',
	"labels" "tree_label"[] NOT NULL DEFAULT '{}',
	"est_planted_at" date,
	"tree_type_id" "tree_type" NOT NULL DEFAULT 'sonstige',
	"description" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "trees_plot_idx" ON "trees"("plot_id");
CREATE INDEX IF NOT EXISTS "trees_parcel_idx" ON "trees"("parcel_id");

-- ===== Tree Images =====
CREATE TABLE IF NOT EXISTS "tree_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tree_id" uuid NOT NULL REFERENCES "trees"("id") ON DELETE CASCADE,
	"s3_key" text NOT NULL,
	"sort_order" integer NOT NULL DEFAULT 0,
	"taken_at" timestamp NOT NULL DEFAULT now(),
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tree_images_tree_idx" ON "tree_images"("tree_id");

-- ===== Work Orders =====
CREATE TABLE IF NOT EXISTS "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"share_token" text NOT NULL UNIQUE,
	"share_expires_at" timestamp,
	"title" text NOT NULL,
	"instructions" text NOT NULL DEFAULT '',
	"worker_notes" text NOT NULL DEFAULT '',
	"status" "work_order_status" NOT NULL DEFAULT 'OPEN',
	"selection_snapshot" jsonb NOT NULL,
	"user_priority" "priority",
	"share_visibility" jsonb NOT NULL DEFAULT '{
		"anfahrten": true,
		"plot_photos": true,
		"areas": true,
		"tree_photos": true,
		"tree_descriptions": false,
		"tree_health": true
	}'::jsonb,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_orders_owner_idx" ON "work_orders"("owner_id");
CREATE INDEX IF NOT EXISTS "work_orders_token_idx" ON "work_orders"("share_token");

-- ===== Work Order Trees =====
CREATE TABLE IF NOT EXISTS "work_order_trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"work_order_id" uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
	"tree_id" uuid NOT NULL REFERENCES "trees"("id") ON DELETE CASCADE,
	"status" "work_order_tree_status" NOT NULL DEFAULT 'OPEN',
	"status_message" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_order_trees_order_idx" ON "work_order_trees"("work_order_id");
CREATE INDEX IF NOT EXISTS "work_order_trees_tree_idx" ON "work_order_trees"("tree_id");
