// All English short-IDs → German UI labels live here.
// See README §3.3 — storage and logic use the English IDs, labels are only
// for rendering. If you find yourself writing a German string in a component,
// move it into this file first.

// ===== Health =====
export const HEALTH_STATUSES = ['healthy', 'must-watch', 'infected', 'dead'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];
export const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: 'Gesund',
  'must-watch': 'Beobachten',
  infected: 'Befallen',
  dead: 'Tot'
};
// Resolved to the `--health-*` CSS variables declared in src/app.css so the
// palette is single-sourced. Use these for map paint expressions or inline
// styles where a CSS class can't reach.
export const HEALTH_COLORS: Record<HealthStatus, string> = {
  healthy: 'var(--health-healthy)',
  'must-watch': 'var(--health-must-watch)',
  infected: 'var(--health-infected)',
  dead: 'var(--health-dead)'
};

// ===== Labels (intended tasks) =====
export const TREE_LABELS = ['cut-down', 'mark', 'fence', 'prune'] as const;
export type TreeLabel = (typeof TREE_LABELS)[number];
export const TREE_LABEL_LABELS: Record<TreeLabel, string> = {
  'cut-down': 'Fällen',
  mark: 'Markieren',
  fence: 'Zaun bauen',
  prune: 'Entasten'
};
// Phosphor icon names per label — see README §3.4.
export const TREE_LABEL_ICONS: Record<TreeLabel, string> = {
  'cut-down': 'Axe',
  mark: 'Flag',
  fence: 'FenceOutline',
  prune: 'Scissors'
};

// ===== Tree types (genus) =====
export const TREE_TYPES = [
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
] as const;
export type TreeType = (typeof TREE_TYPES)[number];
export const TREE_TYPE_LABELS: Record<TreeType, string> = {
  tanne: 'Tanne',
  fichte: 'Fichte',
  kiefer: 'Kiefer',
  eiche: 'Eiche',
  buche: 'Buche',
  laerche: 'Lärche',
  ahorn: 'Ahorn',
  esche: 'Esche',
  birke: 'Birke',
  sonstige: 'Sonstige'
};

// Age thresholds (in years) per species → maturity stage.
// A tree's `est_planted_at` + today's date give its age; this table decides
// the stage. Kept here so the UI "why is this a Jungpflanze?" hint can
// quote the exact thresholds.
export type MaturityStage = 'sapling' | 'juvenile' | 'mature' | 'harvest-ready';
export const MATURITY_STAGES: MaturityStage[] = ['sapling', 'juvenile', 'mature', 'harvest-ready'];
export const MATURITY_LABELS: Record<MaturityStage, string> = {
  sapling: 'Jungpflanze',
  juvenile: 'Jung',
  mature: 'Ausgewachsen',
  'harvest-ready': 'Schlagreif'
};
export const MATURITY_THRESHOLDS: Record<TreeType, [number, number, number]> = {
  // [juvenile, mature, harvest-ready] — years since planting
  tanne: [8, 40, 90],
  fichte: [6, 35, 80],
  kiefer: [8, 40, 100],
  eiche: [10, 60, 140],
  buche: [10, 55, 120],
  laerche: [7, 40, 100],
  ahorn: [8, 45, 110],
  esche: [8, 40, 90],
  birke: [5, 25, 60],
  sonstige: [8, 40, 100]
};

export function maturityStage(treeType: TreeType, plantedAt: Date | null): MaturityStage {
  if (!plantedAt) return 'mature';
  const ageYears = (Date.now() - plantedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const [j, m, h] = MATURITY_THRESHOLDS[treeType];
  if (ageYears < j) return 'sapling';
  if (ageYears < m) return 'juvenile';
  if (ageYears < h) return 'mature';
  return 'harvest-ready';
}

// ===== Route type & vehicle =====
export const ROUTE_TYPES = ['anfahrt', 'rueckegasse'] as const;
export type RouteType = (typeof ROUTE_TYPES)[number];
export const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  anfahrt: 'Anfahrt',
  rueckegasse: 'Rückegasse'
};
export const VEHICLE_TYPES = ['kleingerät', 'großgerät'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  kleingerät: 'Kleingerät',
  großgerät: 'Auch Großgerät'
};

// ===== Priority =====
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend'
};
export const PRIORITY_ORDER: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
};

// ===== Work order statuses =====
export const WORK_ORDER_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Arbeit',
  COMPLETED: 'Abgeschlossen',
  ARCHIVED: 'Archiviert'
};

export const WORK_ORDER_TREE_STATUSES = ['OPEN', 'COMPLETED', 'NOT_FOUND', 'PROBLEM'] as const;
export type WorkOrderTreeStatus = (typeof WORK_ORDER_TREE_STATUSES)[number];
export const WORK_ORDER_TREE_STATUS_LABELS: Record<WorkOrderTreeStatus, string> = {
  OPEN: 'Offen',
  COMPLETED: 'Erledigt',
  NOT_FOUND: 'Nicht gefunden',
  PROBLEM: 'Probleme aufgetreten'
};
