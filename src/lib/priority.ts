// Work-order auto priority (README §4.9).
// `user_priority ?? suggest(order)` is the effective priority shown in the UI.

import type { Priority } from './enums';

export interface OrderPrioritySignals {
  totalTrees: number;
  infectedCount: number;
  deadCount: number;
  cutDownCount: number;
  openDays: number;
  onlyCarelabels: boolean; // labels subset of {mark, fence, prune}, no health concerns
}

export function suggestPriority(s: OrderPrioritySignals): Priority {
  if (s.infectedCount >= 1 || s.deadCount >= 5) return 'urgent';
  if (s.deadCount >= 1) return 'high';
  if (s.totalTrees > 0 && s.cutDownCount / s.totalTrees >= 0.3) return 'high';
  if (s.openDays > 60) return 'high';
  if (s.onlyCarelabels) return 'low';
  return 'normal';
}
