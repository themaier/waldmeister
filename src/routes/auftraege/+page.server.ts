import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { workOrders, workOrderTrees, trees } from '$lib/server/db/schema';
import { eq, desc, ne, and } from 'drizzle-orm';
import { suggestPriority } from '$lib/priority';
import { PRIORITY_ORDER, type Priority } from '$lib/enums';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  const orders = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.ownerId, locals.user.id), ne(workOrders.status, 'ARCHIVED')))
    .orderBy(desc(workOrders.createdAt));

  // Pull signals for the auto-priority suggestion.
  const ordersWithPriority = await Promise.all(
    orders.map(async (o) => {
      const wot = await db
        .select({
          healthStatus: trees.healthStatus,
          labels: trees.labels,
          status: workOrderTrees.status
        })
        .from(workOrderTrees)
        .innerJoin(trees, eq(workOrderTrees.treeId, trees.id))
        .where(eq(workOrderTrees.workOrderId, o.id));

      const total = wot.length;
      const infected = wot.filter((t) => t.healthStatus === 'infected').length;
      const dead = wot.filter((t) => t.healthStatus === 'dead').length;
      const cutDown = wot.filter((t) => t.labels.includes('cut-down')).length;
      const openDays = Math.floor((Date.now() - o.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const onlyCarelabels =
        total > 0 &&
        infected === 0 &&
        dead === 0 &&
        wot.every((t) => t.labels.every((l) => l !== 'cut-down'));
      const suggested = suggestPriority({
        totalTrees: total,
        infectedCount: infected,
        deadCount: dead,
        cutDownCount: cutDown,
        openDays,
        onlyCarelabels
      });
      const effective = (o.userPriority ?? suggested) as Priority;
      return { ...o, suggestedPriority: suggested, effectivePriority: effective, treeTotal: total };
    })
  );

  // Sort by effective priority desc, then createdAt desc.
  ordersWithPriority.sort((a, b) => {
    const d = PRIORITY_ORDER[b.effectivePriority] - PRIORITY_ORDER[a.effectivePriority];
    if (d !== 0) return d;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return { orders: ordersWithPriority };
};
