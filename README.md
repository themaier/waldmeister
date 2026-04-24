# Waldmeister - Design Document

## 1. Project Overview

**Waldmeister** is a modern, mobile-first SaaS platform designed for forest management. It empowers forest owners to digitize their inventory by documenting individual trees with high-precision GPS and imagery. It integrates with official cadastral data (BayernAtlas) to manage land parcels ("Flurstücke") grouped into "Waldstücke", and facilitates seamless coordination with contractors through offline-ready, shareable work orders.

- **Primary Language:** English (Code, table names, documentation).
- **User Interface Language:** German (UI labels, buttons, user feedback).

### 1.1 Terminology (Source of Truth)

To avoid ambiguity across this document:

| Term          | Meaning                                                                                        |
| :------------ | :--------------------------------------------------------------------------------------------- |
| **Waldstück** | A user-defined forest plot. A logical group of one or more Flurstücke. Table: `forest_plots`.  |
| **Flurstück** | An official cadastral parcel as defined by BayernAtlas. Table: `parcels`.                      |
| **Anfahrt**   | A hand-drawn access route attached to a Waldstück. Table: `access_routes`.                     |
| **Fotos**     | Optional photos attached to a Waldstück (e.g., gate, parking, landmarks). Table: `plot_images`.|
| **Bereich**   | A user-drawn polygonal annotation on a Waldstück, optionally applying a health status to contained trees. Table: `areas`. |
| **Baum**      | An individual tree inside a Flurstück, captured with GPS + images. Table: `trees`.             |
| **Auftrag**   | A work order for a contractor, scoped to trees. Table: `work_orders`.                          |

> We deliberately avoid the synonym "Grundstück" — always use **Flurstück** when referring to a cadastral parcel.

---

## 2. Technical Stack

- **Runtime & Package Manager:** **Bun** (not Node.js) — used for install, dev server, scripts, and production runtime. SvelteKit runs on Bun via `svelte-adapter-bun`. `bun.lockb` is the committed lockfile; `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` are not used.
- **Framework:** SvelteKit (utilizing experimental Remote Functions for BE/FE communication).
- **Live Updates:** Server-Sent Events (SSE) for real-time progress tracking of work orders.
- **Styling & UI Components:**
  - Tailwind CSS.
  - DaisyUI (Tailwind plugin), theme customized to the Forest palette.
  - **Icons:** Phosphor Icons, via [`phosphor-svelte`](https://www.npmjs.com/package/phosphor-svelte) — Svelte-native components, inline SVG (no runtime fetch, no icon font), tree-shakeable per icon. See §3.5.
- **Authentication:** Better-auth (Email/Password, email verification, password reset).
- **Database:** PostgreSQL with UUIDs for primary keys; PostGIS enabled for geometry columns.
- **Object Storage:** S3-compatible API (e.g., Cloudflare R2).
  - _Structure:_ `bucket/users/{userId}/trees/{treeId}/{uuid}.jpg`, `bucket/users/{userId}/plots/{plotId}/{uuid}.jpg`, and `bucket/users/{userId}/areas/{areaId}/{uuid}.jpg` (configurable via env).
- **Mapping & GIS:** BayernAtlas API (satellite imagery and Flurstück outlines) rendered in an interactive map component (see §6).
- **Offline Support:**
  - Service Workers for asset and map tile caching.
  - IndexedDB for local data and image persistence; mutation queue for deferred writes.
- **Deployment:** Fully functional in standard browsers and installable as a PWA.

---

## 3. Design System & UI Architecture

The UI follows a **Modern SaaS** aesthetic — clean, functional, and professional — with a **Forest Theme** using deep greens, mossy tones, and organic border rounding.

### 3.1 Design Tokens

Instead of ad-hoc styling, the app uses a centralized token system defined in the global configuration:

- **Palette:** A collection of raw colors (e.g., Pine Green, Bark Brown, Moss, Earth White).
- **Component Variables:** Semantic mapping of the palette to UI elements (e.g., `primary` → Pine Green, `background` → Earth White).
- **Layout Tokens:** Standardized spacing, padding, and border-radius variables to ensure consistency across the mobile-first interface.

### 3.2 Component Strategy

- **Svelte Components:** Everything is built using reusable components.
- **DaisyUI Integration:** Standard DaisyUI components are used as the foundation and styled via the design tokens to match the forest theme.
- **Logic Decoupling:** Components like the "Button" are standardized to handle multiple types (Primary, Secondary, Ghost) via props, avoiding ad-hoc styling in views.
- **Accessibility:** Semantic HTML, proper `<label>` associations for inputs, and high-contrast ratios for outdoor sunlight readability. Touch targets ≥ 44×44 px for glove-friendly operation.

### 3.3 Enum Mappings

A central frontend module defines all `english_id → German label` mappings for enums (tree health status, work order tree status, tree types, tree labels, maturity stages). Storage and logic always use the English short IDs; rendering is the only place the German label appears.

### 3.4 Icons

All icons in the app come from **Phosphor Icons** via **`phosphor-svelte`**. The package exposes each icon as its own Svelte component that renders an inline `<svg>` directly into the DOM — no sprite sheets, no `<img>` fetches, no icon font, no `@iconify` runtime. This means icons ship as part of the rendered HTML and are tree-shaken per icon at build time (only the icons actually imported land in the bundle).

**Rules:**

- **Color** — never hard-code a fill. Every Phosphor icon defaults its color to `currentColor`, so an icon's color follows the surrounding text `color`. Change color via CSS (`class="text-primary"`, `style="color: var(--moss)"`, etc.), not via a `color=` prop, unless a one-off needs it.
- **Size** — pass the `size` prop (number → px, or a CSS length like `"1.25em"`). Prefer `em`-based sizes so icons scale with their container's font size. Default size is `1em` (matches adjacent text).
- **Weight** — Phosphor ships six weights (`thin`, `light`, `regular`, `bold`, `fill`, `duotone`). The app locks to **`regular`** for consistency; `fill` is permitted for "active/selected" toggle states. Other weights are avoided unless there's a strong reason.
- **Import style** — import exactly the icons used: `import { Tree, MapPin, Camera } from 'phosphor-svelte'`. Never barrel-import the whole package.
- **Wrapper component** — a thin `<Icon name="…" />` wrapper is *not* introduced; the Phosphor components already are the wrapper. Using them directly keeps imports explicit and tree-shaking obvious.

This rule applies uniformly: health-status badges, marker labels, toolbar buttons, empty-state illustrations, and PDF exports all use the same source.

### 3.5 Derived Values

Some values that look like data are actually computed at read time and must never be persisted:

- **`maturity_stage`** (`sapling` / `juvenile` / `mature` / `harvest-ready`) is derived from `est_planted_at` + `tree_type_id` + today's date, using species-specific age thresholds defined in the same central enum file. It is recomputed on every render, so a tree transitions to the next stage automatically as it ages — the user never needs to touch it. If a tree looks older or younger than its age suggests, the user corrects `est_planted_at`, not the stage.

---

## 4. Database Schema (English)

All tables use `id: UUID (PK)` and have `created_at: Timestamp`. Mutable entities also have `updated_at: Timestamp`.

**Cascading deletes.** All dependent child rows are removed via `ON DELETE CASCADE`:

- `forest_plots` → `parcels`, `access_routes`, `plot_images`, `areas`, `trees`.
- `areas` → `area_images`.
- `trees` → `tree_images`, `work_order_trees`.
- `work_orders` → `work_order_trees`.

S3 objects referenced by deleted `*_images` rows are marked for cleanup by a background worker (see §8) so the delete itself stays fast and works offline.

### 4.1 Forest Plots (`forest_plots`) — Waldstück

- `owner_id`: UUID (FK → users)
- `name`: String (Optional, user-defined)

### 4.2 Parcels (`parcels`) — Flurstück

- `plot_id`: UUID (FK → forest_plots)
- `cadastral_id`: String (Official ID from BayernAtlas, unique per plot)
- `geometry`: PostGIS Polygon (outline coordinates, stored as WGS84 / EPSG:4326)

### 4.3 Access Routes (`access_routes`) — Anfahrt

- `plot_id`: UUID (FK → forest_plots)
- `name`: String (Optional, e.g., "Von der Landstraße")
- `path_data`: GeoJSON LineString (hand-drawn coordinates)

### 4.4 Plot Images (`plot_images`) — Waldstück-Fotos

Photos attached to a whole Waldstück (not a specific tree) — e.g., gate, parking spot, boundary marker, damage overview. Independent from tree images.

- `plot_id`: UUID (FK → forest_plots)
- `s3_key`: String (object key in the bucket)
- `name`: String (Optional, user-defined, e.g., "Tor am Wirtschaftsweg")
- `sort_order`: Integer (0-based, user-reorderable)
- `latitude` / `longitude`: Decimal (Nullable — captured at photo time if GPS is available)
- `gps_accuracy_m`: Decimal (Nullable)
- `show_on_map`: Boolean (default `true` when geotagged, `false` otherwise — user-toggleable)
- `taken_at`: Timestamp (EXIF or capture time)
- `width_px` / `height_px`: Integer (for layout without loading)
- `updated_at`: Timestamp

### 4.5 Areas (`areas`) — Bereich

User-drawn polygonal regions attached to a Waldstück. Can carry a comment, an optional applied tree status, and photos. Used to annotate regions ("Sturmschaden März 2026", "Befallener Abschnitt") and to bulk-update the health status of all trees inside after large events, saving tedious per-tree edits.

- `plot_id`: UUID (FK → forest_plots)
- `geometry`: PostGIS Polygon (WGS84 / EPSG:4326). All three drawing tools (rectangle, freehand, point-by-point) produce a polygon.
- `comment`: Text (Nullable)
- `applied_tree_status`: Enum (Nullable) — mirrors `trees.health_status` (`dead`, `healthy`, `infected`, `must-watch`). Records that this status was applied to all trees inside `geometry` on the last submit. It is a record of intent, not a live filter — individual trees may diverge afterward.
- `updated_at`: Timestamp

### 4.6 Area Images (`area_images`) — Bereich-Fotos

Photos attached to an area. Same shape as `tree_images`, no name field.

- `area_id`: UUID (FK → areas)
- `s3_key`: String
- `sort_order`: Integer (0-based)
- `taken_at`: Timestamp
- `width_px` / `height_px`: Integer
- `updated_at`: Timestamp

### 4.7 Trees (`trees`)

- `plot_id`: UUID (FK → forest_plots)
- `parcel_id`: UUID (FK → parcels, nullable — resolved server-side via point-in-polygon when possible)
- `latitude`: Decimal
- `longitude`: Decimal
- `gps_accuracy_m`: Decimal (the reported GPS accuracy at capture time, in meters)
- `health_status`: Enum — `dead`, `healthy`, `infected`, `must-watch` (English IDs, mapped to German labels in the central enum file)
- `labels`: Enum array — `cut-down`, `mark`, `fence`, `prune` (the owner's intended tasks; independent of health)
- `est_planted_at`: Date (user enters either a tree age in years or a direct date; the backend normalizes to a date and stores it)
- `tree_type_id`: Enum — genus of the tree (`tanne`, `fichte`, `kiefer`, `eiche`, …)
- `description`: Text
- `updated_at`: Timestamp

### 4.8 Tree Images (`tree_images`)

Multiple images per tree are supported. Ordering is explicit; the first image (lowest `sort_order`) is the cover image shown in lists and map popups.

- `tree_id`: UUID (FK → trees)
- `s3_key`: String (object key in the bucket)
- `sort_order`: Integer (0-based)
- `taken_at`: Timestamp (EXIF or capture time)
- `width_px` / `height_px`: Integer (for layout without loading)

### 4.9 Work Orders (`work_orders`) — Arbeitsauftrag

- `owner_id`: UUID (FK → users)
- `share_token`: String (unique, URL-safe, revocable and regeneratable)
- `title`: String
- `instructions`: Text
- `worker_notes`: Text (feedback from contractor)
- `status`: Enum — `OPEN`, `IN_PROGRESS`, `COMPLETED`, `ARCHIVED`
- `selection_snapshot`: JSON (records what was selected at creation time — either `{ type: "plot", plot_id }` or `{ type: "trees", tree_ids: [...] }` — so the owner's intent is preserved even if trees are added/removed later)
- `updated_at`: Timestamp

### 4.10 Work Order Trees (`work_order_trees`)

Flattened list of every tree the contractor is expected to visit. Regenerated when a `plot`-type selection is resolved.

- `work_order_id`: UUID (FK → work_orders)
- `tree_id`: UUID (FK → trees)
- `status`: Enum — `OPEN`, `COMPLETED`, `NOT_FOUND`, `PROBLEM`
- `status_message`: Text (optional per-tree feedback)
- `updated_at`: Timestamp

---

## 5. Core Workflows

### 5.1 Authentication & Onboarding

1. User registers with email + password (Better-auth).
2. Email verification required before accessing the app.
3. Password reset via email link.
4. First-time users land on an empty dashboard with a primary CTA: **"Neues Waldstück erstellen"**.

### 5.2 Dashboard ("Meine Wälder")

- Lists all of the user's Waldstücke as cards with: name, Flurstück count, tree count, last-activity date, and a mini-map preview.
- Primary actions: create new Waldstück, open existing Waldstück, jump to active work orders.
- Global search filters the list by name.

### 5.3 Waldstück Creation

1. User clicks **"Neues Waldstück erstellen"**.
2. A map view loads with BayernAtlas satellite imagery and Flurstück outline overlay.
3. **Parcel Selection:** User taps individual Flurstücke. Tapping an unselected parcel highlights it; tapping it again removes it. The selection count is shown in a sticky bottom bar.
4. User optionally names the group and saves.
5. **Smart Navigation:** The overview map displays one Waldstück at a time. The map automatically fits to the bounds of all parcels in the current Waldstück (with padding). Navigation arrows cycle through Waldstücke, animating the pan/zoom to the next one.

### 5.4 Access Routes ("Anfahrt")

1. Available only after parcels are assigned to a Waldstück.
2. User enters drawing mode.
3. **Signature-style Drawing:** The user draws the route manually with their finger on the map. During drawing, pan/zoom is disabled to avoid accidental gestures.
4. After releasing, the user must choose **"Übernehmen"** (Accept) or **"Wiederholen"** (Redo).
5. Multiple routes can be saved per Waldstück. Each route has an optional name and can be individually deleted.

### 5.5 Waldstück Photos ("Fotos")

Users capture supplementary photos for a whole Waldstück — typical subjects are the gate ("Tor"), parking spot, boundary markers, piled logs, or a damage overview. These live on the Waldstück, not on any specific tree.

**Entry point.** In the Waldstück detail view, a **"Fotos"** section sits alongside Flurstücke, Anfahrten, and the tree list. Empty-state copy explains the feature: _"Halte wichtige Orte wie Tore, Zufahrten oder Lagerplätze fest."_

**Capture flow.**

1. User taps **"+ Foto hinzufügen"** → native camera opens, with a "Aus Galerie wählen" fallback for photos taken earlier.
2. After capture, a **confirmation sheet** shows the thumbnail and three fields:
   - **Name** (optional, single line, placeholder _"z.B. Tor am Wirtschaftsweg"_).
   - **"Auf Karte anzeigen"** toggle — defaults to **on** if GPS was available at capture time, **off** (and disabled) otherwise. Users can turn it off for generic overview shots.
   - Cancel / **"Speichern"**.
3. On save, the photo is written to IndexedDB immediately and queued for S3 upload (same pipeline as tree images).

**Gallery view.**

- 3-column grid on mobile (5–6 on desktop), tiles sorted by `sort_order`.
- Each tile shows the thumbnail with the name overlaid along the bottom (truncated) and a small map-pin badge in the corner when `show_on_map` is true.
- Tap a tile → fullscreen lightbox with swipe navigation, inline rename (tap the name to edit), a map-visibility toggle, a reorder affordance, and delete (with confirmation).

**Reordering & cover.** Drag-to-reorder in edit mode; the first photo becomes the cover shown in the Waldstück's dashboard card.

**Offline.** Same behavior as tree photos — capture works offline, upload deferred.

### 5.6 Tree Inventory (Field Workflow)

1. **Permissions:** Mandatory check for Camera and GPS. Denying these triggers a block-screen explaining their necessity and linking to the OS settings.
2. **Add Tree:** **"Baum hinzufügen"** opens the capture mask.
3. **Automated Capture:** Taking a picture automatically pulls current GPS coordinates and accuracy.
4. **Multiple Images:** The user can add several images per tree. The first is the cover; subsequent images can be reordered and individually removed before saving.
5. **Manual Override:** A **"Koordinaten erneut erfassen"** button allows re-polling GPS if the signal was weak. A low-accuracy warning appears when `gps_accuracy_m > 10`.
6. **Classification:** The user sets `tree_type_id`, `health_status`, zero or more `labels`, and optionally `est_planted_at` (as age or date).
7. **Offline Support:** Photos and metadata are saved to IndexedDB immediately; the mutation queue syncs to the server when connectivity returns.

### 5.7 Tree Detail & Edit

- Accessible from any list or from a map marker.
- Shows image carousel, metadata, health/labels/maturity, and placement on a mini-map.
- Supports: editing all fields, adding/removing/reordering images, and re-capturing coordinates.
- **Delete ("Baum löschen").** For when a tree has been felled or was entered in error. A red destructive action at the bottom of the edit screen opens a confirmation.
  - If the tree is part of a non-archived work order, the confirmation warns: _"Dieser Baum ist Teil des Auftrags 'X'. Beim Löschen wird er aus dem Auftrag entfernt."_
  - On confirm, the row is deleted; `tree_images` and `work_order_trees` cascade (see §4); S3 cleanup is queued.

### 5.8 Areas ("Bereiche")

Areas let the user annotate a region of a Waldstück with a polygon — e.g., "Sturmschaden März 2026" or "Befallener Abschnitt" — and optionally apply a single health status to every tree inside in one action, saving tedious per-tree edits after large events.

**Entry point.** The map toolbar exposes a **"Bereich auswählen"** button. Tapping it reveals a tool picker:

1. **Rechteck** — tap-and-drag across the map to define a bounding box; releasing commits a 4-vertex polygon. The shape can still be reshaped via drag-to-resize handles before applying.
2. **Zeichnen** (freehand) — the user draws the outline with their finger. **Map pan/zoom is locked while this tool is active** (same lock used during Anfahrt drawing) so the map doesn't slide under the finger. The shape auto-closes when the finger is lifted.
3. **Punkte setzen** (point-by-point) — tap once per vertex; tap the first vertex again (or double-tap) to close the polygon. An **"Letzten Punkt entfernen"** button undoes the most recent vertex.

Each tool ends with **"Übernehmen"** (Accept) / **"Wiederholen"** (Redo), matching the Anfahrt pattern.

**Apply dialog.** On accept, a bottom-sheet opens with:

- **Kommentar** — multi-line text, optional.
- **Baumstatus anwenden** — status picker (Gesund / Befallen / Tot / Beobachten), optional. A helper line shows _"Wird auf N Bäume in diesem Bereich angewendet"_ with the live count from a point-in-polygon check against the current tree set.
- **Fotos** — add-photo tile plus thumbnails of already-added photos (same capture/IndexedDB pipeline as Waldstück photos; no name field on area photos).
- **"Speichern"** / **"Abbrechen"**.

On save: the area is persisted, and if `applied_tree_status` is set, the backend runs a point-in-polygon query and updates `health_status` for every contained tree in a single transaction.

**Display on the map.** A new toggleable **Bereiche** layer is **on by default**. Each area renders as a translucent polygon:

- Fill color reflects `applied_tree_status` when set (e.g., red tint for `infected`, grey for `dead`, amber for `must-watch`), neutral forest-green otherwise.
- Stroke is always drawn, so areas remain legible even when fills overlap or are muted.

**Editing.** Tapping an area opens a bottom sheet with its comment, status, photos, and actions:

- Inline edits for comment, status, and photos.
- **"Grenzen bearbeiten"** reveals vertex handles on the polygon; drag to move a vertex, tap-and-hold to delete one, double-tap a segment to insert a new vertex. Map pan/zoom stays enabled in this mode (only the initial freehand drawing tool locks the map).
- **"Status erneut anwenden"** — re-runs the point-in-polygon status application against the *current* tree set. Useful after adding new trees inside an existing area, since bulk application does NOT happen automatically when trees are added later.
- **"Bereich löschen"** (red) — see below.

**Re-application rules (explicit).** Status is applied to contained trees only on:

1. Area creation with a status set, OR
2. Edit where the status itself changes, OR
3. An explicit tap of "Status erneut anwenden".

Editing only the geometry does **not** reclassify trees — the user may be fine-tuning the boundary and should not be surprised by stale edits.

**Deletion.**

- If `applied_tree_status` is `null` → simple confirmation _"Bereich löschen?"_ → delete.
- If `applied_tree_status` is set → a three-way prompt:
  _"Dieser Bereich hat den Status 'Befallen' auf X Bäume angewendet. Sollen diese Bäume auf 'Gesund' zurückgesetzt werden?"_
  - **"Ja, zurücksetzen und löschen"** — reset trees currently inside the polygon to `healthy`, then delete.
  - **"Nein, nur Bereich löschen"** — delete the area, leave tree statuses as-is.
  - **"Abbrechen"**.
  The reset only targets trees currently inside the polygon; trees that have moved out of the area since the last submit are untouched.

**Contractor view.** Areas are rendered read-only on the contractor map (tap opens a read-only bottom sheet with comment + photos). An "infected region" is critical field information.

**Offline.** Drawing, editing, photo attachments, and bulk tree-status application all queue through IndexedDB and replay via the normal sync engine.

### 5.9 Work Orders ("Arbeitsauftrag")

1. Owner creates a **"Neuer Auftrag"**, enters a title and instructions.
2. **Selection:** Owner selects either a whole Waldstück (region) OR individual trees (even across different Waldstücke). The selection is preserved in `selection_snapshot` and flattened into `work_order_trees` for tracking.
3. Owner generates a public shareable link (via the `share_token`) and shares it via **WhatsApp** or clipboard.
4. **Link Management:** The owner can revoke a link (marks the token invalid) and regenerate a new one. Archiving a work order hides it from the default list.
5. **PDF Export:** An optional print-friendly PDF bundles instructions, a static map with markers, and a tree checklist — useful for contractors with spotty reception.

---

## 6. Map & Visualization

The map is the central interface for most workflows and must feel fast, obvious, and touch-friendly.

### 6.1 Base Map & Layers

- **Base:** BayernAtlas satellite tiles (cached for offline).
- **Overlays** (each independently toggleable):
  - Flurstück outlines (from BayernAtlas).
  - Trees (as markers).
  - Access Routes (Anfahrten).
  - Plot photos (Fotos) — geotagged photos with `show_on_map = true`, rendered as camera-icon pins. Tapping a pin opens a small popup with the thumbnail, name, and a "Foto öffnen" link to the lightbox.
  - Areas (Bereiche) — translucent polygons, fill tinted by `applied_tree_status` when set. **On by default.**
  - Current user location (GPS, with accuracy halo).

### 6.2 Interaction

- Standard **pinch / double-tap / scroll-wheel zoom** and **drag pan**.
- Zoom controls visible as on-screen `+` / `−` buttons for one-hand operation.
- A **"Fit to Waldstück"** button re-centers and zooms to the currently active plot.
- **Long-press** on the map in the field workflow → prompts "Baum hier hinzufügen?" with the pressed coordinates pre-filled (useful when GPS is inaccurate or when marking a tree remotely).
- **Drawing-mode lock.** Whenever a freehand drawing tool is active — Anfahrt drawing, or the **Zeichnen** tool for areas — map pan/zoom is disabled so finger drawing does not accidentally move the map. Other area tools (Rechteck, Punkte setzen) and geometry-editing (vertex handles) leave pan/zoom enabled.

### 6.3 Tree Markers

- Each tree is rendered as a small **dot** whose color encodes `health_status`; a small badge indicates primary `label` (e.g., a saw icon for `cut-down`).
- **Clustering:** At low zoom levels, nearby trees are clustered with a count; tapping a cluster zooms in.
- **Tap a marker** → opens a compact popup with cover image, species, status/labels, and a "Details öffnen" link.
- **Selection uncertainty halo:** When a single tree is selected (via tap or from a list), a translucent circle is drawn around it representing GPS uncertainty — the tree could be anywhere inside it. The radius uses the tree's stored `gps_accuracy_m`, clamped to a minimum of 3 m (so it stays visible) and a sensible default of ~10 m when accuracy is unknown. This makes the "you'll have to look around a bit" reality explicit, especially for contractors in the field.
- At very high zoom, markers expand to show the cover thumbnail inline.

### 6.4 Filters

A filter drawer on the map allows filtering visible trees by:

- Health status (multi-select)
- Labels (multi-select)
- Maturity stage
- Tree type (genus)

Filters are purely visual (they hide markers); they do not delete data.

### 6.5 Contractor Map

The contractor's shared view reuses the same map with a reduced toolset:

- Flurstück outlines, Anfahrten, plot photos (read-only, especially useful for locating gates and parking), areas (read-only, tap opens comment + photos), and only the trees in this work order.
- Per-tree status is reflected in the marker color (OPEN / COMPLETED / NOT_FOUND / PROBLEM).
- A top progress bar shows overall completion.

---

## 7. Contractor Experience

- **No-Login Access:** Contractors access the tasks via the unique shareable link.
- **Preparation View:** Summarizes tree count, required tasks (derived from `labels`), and recommended tools.
- **Navigation:** Displays the map with parcel outlines and the hand-drawn Anfahrten (see §6.5).
- **Feedback:**
  - Contractors mark each tree as **"Erledigt"** (Done), **"Probleme aufgetreten"** (Problems), or **"Nicht gefunden"** (Not found), with an optional per-tree note.
  - Contractors can add **"Notizen"** (Notes) to the entire order for the owner to read.
- **Real-time Sync:** As the contractor updates statuses, the owner's view updates live via SSE.
- **Offline:** The contractor view is also offline-capable — updates queue locally and flush when reconnected.

---

## 8. Offline & Sync Strategy

1. **Map Caching:** When a connection is available, the app caches BayernAtlas tiles covering the user's Waldstücke (at multiple zoom levels) into the Service Worker cache.
2. **Persistence:** All edits (new trees, status changes, drawings, areas, image blobs for trees / plots / areas) are stored in IndexedDB. Bulk status updates from area submits are applied to the local tree cache immediately and queued as a single mutation.
3. **Mutation Queue:** Each write produces a queued mutation with a client-generated UUID. The queue is visible to the user (a small "N ausstehende Änderungen" indicator in the header).
4. **Sync Engine:** The app monitors connectivity. When back online, it replays the queue via SvelteKit Remote Functions and uploads images to S3. Failed items are retried with exponential backoff; permanently failed items surface in a sync-issue screen.
5. **Conflict Resolution:** Last-write-wins by `updated_at` for scalar fields. For work-order tree status, the contractor's update is authoritative while the order is `IN_PROGRESS`.

---

## 9. UI Glossary (English Logic → German Label)

| Context        | English                         | German UI Label                                  |
| :------------- | :------------------------------ | :----------------------------------------------- |
| Navigation     | Next / Previous Plot            | Nächstes / Vorheriges Waldstück                  |
| Navigation     | My Forests (Dashboard)          | Meine Wälder                                     |
| Setup          | Create Forest Plot              | Neues Waldstück erstellen                        |
| Setup          | Parcel (cadastral)              | Flurstück                                        |
| Infrastructure | Access Route                    | Anfahrt                                          |
| Infrastructure | Accept / Redo                   | Übernehmen / Wiederholen                         |
| Plot Photos    | Photos                          | Fotos                                            |
| Plot Photos    | Add Photo                       | Foto hinzufügen                                  |
| Plot Photos    | Show on Map                     | Auf Karte anzeigen                               |
| Plot Photos    | Rename                          | Umbenennen                                       |
| Inventory      | Add Tree                        | Baum hinzufügen                                  |
| Inventory      | Retake Coordinates              | Koordinaten erneut erfassen                      |
| Inventory      | Delete Tree                     | Baum löschen                                     |
| Areas          | Select Area                     | Bereich auswählen                                |
| Areas          | Rectangle / Freehand / Points   | Rechteck / Zeichnen / Punkte setzen              |
| Areas          | Remove last point               | Letzten Punkt entfernen                          |
| Areas          | Apply Tree Status               | Baumstatus anwenden                              |
| Areas          | Re-apply Status                 | Status erneut anwenden                           |
| Areas          | Edit Boundaries                 | Grenzen bearbeiten                               |
| Areas          | Delete Area                     | Bereich löschen                                  |
| Tree Health    | Dead / Healthy / Infected / Must Watch | Tot / Gesund / Befallen / Beobachten       |
| Tree Labels    | Cut down / Mark / Fence / Prune | Fällen / Markieren / Zaun bauen / Entasten       |
| Tree Maturity  | Sapling / Juvenile / Mature / Harvest Ready | Jungpflanze / Jung / Ausgewachsen / Schlagreif |
| Map            | Fit to Plot                     | Auf Waldstück zoomen                             |
| Map            | Filters                         | Filter                                           |
| Operations     | Work Order                      | Arbeitsauftrag                                   |
| Operations     | New Order                       | Neuer Auftrag                                    |
| Operations     | Archive / Revoke Link           | Archivieren / Link widerrufen                    |
| Contractor     | Done / Problems / Not found     | Erledigt / Probleme aufgetreten / Nicht gefunden |
| Contractor     | Notes                           | Notizen                                          |
| Sync           | Pending changes                 | Ausstehende Änderungen                           |
