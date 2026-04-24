# Waldmeister - Design Document

## 1. Project Overview

**Waldmeister** is a modern, mobile-first SaaS platform designed for forest management. It empowers forest owners to digitize their inventory by documenting individual trees with high-precision GPS and imagery. It integrates with official cadastral data (BayernAtlas) to manage land parcels ("Waldstücke") and facilitates seamless coordination with contractors through offline-ready, shareable work orders.

- **Primary Language:** English (Code, Table names, Documentation).
- **User Interface Language:** German (UI Labels, Buttons, User feedback).

---

## 2. Technical Stack

- **Framework:** SvelteKit (utilizing experimental Remote Functions for BE/FE communication).
- **Live Updates:** Server-Sent Events (SSE) for real-time progress tracking of work orders.
- **Styling & UI Components:** \* Tailwind CSS.
  - Svelte DaisyUI components (customized for theme).
- **Authentication:** Better-auth (Email/Password).
- **Database:** PostgreSQL with UUIDs for primary keys.
- **Object Storage:** S3-compatible API (e.g., Cloudflare R2).
  - _Structure:_ `bucket/users/{userId}/trees/{treeId}.jpg` (configurable via env).
- **Mapping & GIS:** BayernAtlas API (Satellite imagery and Flurstück/parcel outlines).
- **Offline Support:** \* Service Workers for asset caching.
  - IndexedDB for local data and image persistence.
- **Deployment:** Fully functional in standard browsers and installable as a PWA.

---

## 3. Design System & UI Architecture

The UI follows a **Modern SaaS** aesthetic—clean, functional, and professional—with a **Forest Theme** utilizing deep greens, mossy tones, and organic border rounding.

### 3.1 Design Tokens

Instead of ad-hoc styling, the app uses a centralized token system defined in the global configuration:

- **Palette:** A collection of raw colors (e.g., Pine Green, Bark Brown, Moss, Earth White).
- **Component Variables:** Semantic mapping of the palette to UI elements (e.g., `primary` maps to Pine Green, `background` maps to Earth White).
- **Layout Tokens:** Standardized spacing, padding, and border-radius variables to ensure consistency across the mobile-first interface.

### 3.2 Component Strategy

- **Svelte Components:** Everything is built using reusable components.
- **DaisyUI Integration:** Standard DaisyUI components are used as the foundation and styled via the design tokens to match the forest theme.
- **Logic Decoupling:** Components like the "Button" are standardized to handle multiple types (Primary, Secondary, Ghost) via props to avoid individual styling in the views.
- **Accessibility:** Use of semantic HTML elements, proper `<label>` associations for inputs, and high-contrast ratios for outdoor sunlight readability.

---

## 4. Database Schema (English)

### 4.1 Forest Plots (`forest_plots`)

- `id`: UUID (PK)
- `owner_id`: UUID (FK to users)
- `name`: String (Optional)
- `created_at`: Timestamp

### 4.2 Parcels (`parcels`)

- `id`: UUID (PK)
- `plot_id`: UUID (FK to forest_plots)
- `cadastral_id`: String (Official ID from BayernAtlas)
- `geometry`: GeoJSON/PostGIS (Outline coordinates)

### 4.3 Access Routes (`access_routes`)

- `id`: UUID (PK)
- `plot_id`: UUID (FK to forest_plots)
- `path_data`: JSON/GeoJSON (Hand-drawn path data)
- `created_at`: Timestamp

### 4.4 Trees (`trees`)

- `id`: UUID (PK)
- `plot_id`: UUID (FK to forest_plots)
- `image_key`: String (S3 path/folder per user)
- `latitude`: Decimal
- `longitude`: Decimal
- `status`: Enum, english short ids that will be mapped to german in code. (have a central file in frontend for enum mappings) (e.g., 'dead', 'healthy', 'infected', 'must-watch')
- `est_planted_at`: date. user can enter either tree age and we will auto-calculate the year to store, or user inputs date directly. based on this year, we can display tree growth stage.
- `tree_type_id`: Enum, genus of the tree, english short ids that will be mapped to german in code. (e.g. tanne, fichte, kiefer, eiche, ..)
- `description`: Text
- `created_at`: Timestamp

### 4.5 Work Orders (`work_orders`)

- `id`: UUID (PK)
- `owner_id`: UUID (FK to users)
- `share_token`: String (Unique token for contractor access)
- `instructions`: Text
- `worker_notes`: Text (Feedback from contractor)
- `status`: Enum (OPEN, IN_PROGRESS, COMPLETED)

### 4.6 Work Order Trees (`work_order_trees`)
- `id`: UUID (PK)
- `work_order_id`: UUID (FK to work_orders)
- `tree_id`: UUID (FK to trees)
- `status`: enum (OPEN, COMPLETED, NOT_FOUND, PROBLEM)
- `status_message`: text (individual optional feedback message for the tree)



---

## 5. Core Workflows

### 5.1 "Waldstück" Creation

1. User clicks **"Neues Waldstück erstellen"**.
2. A map view loads with BayernAtlas data.
3. **Parcel Selection:** User clicks on specific parcels ("Grundstücke"). Clicking an unselected parcel highlights it; clicking it again removes it.
4. User optionally names the group and saves.
5. **Smart Navigation:** The overview map displays one "Waldstück" (can contain multiple parcels, zoom out accordingly to show them all perfectly fit) at a time. Navigation arrows allow the user to cycle through plots, automatically panning the map to the correct coordinates.

### 5.2 Access Routes ("Anfahrt")

1. Available only after parcels are assigned to a Waldstück.
2. User enters drawing mode.
3. **Signature-style Drawing:** The user draws the route manually with their finger on the map.
4. The user must choose either **"Übernehmen"** (Accept) or **"Wiederholen"** (Redo).
5. Multiple routes can be saved per Waldstück.

### 5.3 Tree Inventory (Field Workflow)

1. **Permissions:** Mandatory check for Camera and GPS. Denying these triggers a block-screen explaining their necessity.
2. **Add Tree:** **"Baum hinzufügen"** opens the mask.
3. **Automated Capture:** Taking a picture automatically pulls current GPS coordinates.
4. **Manual Override:** A **"Koordinaten erneut erfassen"** button allows the user to re-poll GPS data if the signal was weak.
5. **Offline Support:** The photo and metadata are saved to IndexedDB immediately, ensuring no data loss in areas with poor reception.

### 5.4 Work Orders ("Arbeitsauftrag")

1. Owner creates a **"Neuer Auftrag"**.
2. **Selection:** Owner selects a whole **Waldstück** (region) OR picks individual trees (even across different plot boundaries).
3. Owner adds text instructions.
4. Owner generates and shares a public link via **WhatsApp** or clipboard.

---

## 6. Contractor Experience

- **No-Login Access:** Contractors access the tasks via the unique shareable link.
- **Preparation View:** Summarizes tree count and tasks to help the contractor select the correct tools.
- **Navigation:** Displays the map with parcel outlines and the hand-drawn **"Anfahrten"**.
- **Feedback:** \* Contractors mark trees as **"Erledigt"** (Done), **"Probleme aufgetreten"** (Problems), or **"Nicht gefunden"**.
  - Contractors can add **"Notizen"** (Notes) to the entire order for the owner to read.
- **Real-time Sync:** As the contractor updates statuses, the owner's view updates live via **SSE**.

---

## 7. Offline & Sync Strategy

1. **Map Caching:** When a connection is available, the app caches BayernAtlas tiles for the user's specific Waldstücke.
2. **Persistence:** All edits (new trees, status changes, drawings) are stored in the browser's IndexedDB.
3. **Sync Engine:** The app monitors connectivity. When back online, it utilizes SvelteKit Remote Functions to sync the local database queue with the PostgreSQL server and upload images to S3.

---

## 8. UI Glossary (English Logic -> German Label)

| Context        | English                     | German UI Label                                  |
| :------------- | :-------------------------- | :----------------------------------------------- |
| Navigation     | Next / Previous Plot        | Nächstes / Vorheriges Waldstück                  |
| Setup          | Create Forest Plot          | Neues Waldstück erstellen                        |
| Infrastructure | Access Route                | Anfahrt                                          |
| Infrastructure | Accept / Redo               | Übernehmen / Wiederholen                         |
| Inventory      | Add Tree                    | Baum hinzufügen                                  |
| Inventory      | Retake Coordinates          | Koordinaten erneut erfassen                      |
| Tree Labels    | Cut down / Mark / Fence     | Fällen / Markieren / Zaun bauen                  |
| Tree Maturity  | Harvest Ready               | Schlagreif                                       |
| Operations     | Work Order                  | Arbeitsauftrag                                   |
| Contractor     | Done / Problems / Not found | Erledigt / Probleme aufgetreten / Nicht gefunden |
| Contractor     | Notes                       | Notizen                                          |
