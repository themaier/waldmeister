import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { workOrders, workOrderTrees, trees } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { suggestPriority } from '$lib/priority';
import type { Priority } from '$lib/enums';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const [order] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, params.id), eq(workOrders.ownerId, locals.user!.id)))
    .limit(1);
  if (!order) throw error(404, 'Auftrag nicht gefunden.');

  const wot = await db
    .select({
      id: workOrderTrees.id,
      status: workOrderTrees.status,
      statusMessage: workOrderTrees.statusMessage,
      treeId: trees.id,
      healthStatus: trees.healthStatus,
      labels: trees.labels,
      latitude: trees.latitude,
      longitude: trees.longitude
    })
    .from(workOrderTrees)
    .innerJoin(trees, eq(workOrderTrees.treeId, trees.id))
    .where(eq(workOrderTrees.workOrderId, order.id));

  const total = wot.length;
  const openDays = Math.floor((Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const suggested = suggestPriority({
    totalTrees: total,
    infectedCount: wot.filter((t) => t.healthStatus === 'infected').length,
    deadCount: wot.filter((t) => t.healthStatus === 'dead').length,
    cutDownCount: wot.filter((t) => t.labels.includes('cut-down')).length,
    openDays,
    onlyCarelabels: wot.every(
      (t) => t.healthStatus !== 'infected' && t.healthStatus !== 'dead' && t.labels.every((l) => l !== 'cut-down')
    )
  });
  const effective = (order.userPriority ?? suggested) as Priority;

  const shareUrl = `${url.origin}/a/${order.shareToken}`;

  return {
    order: { ...order, suggestedPriority: suggested, effectivePriority: effective },
    trees: wot.map((t) => ({
      ...t,
      latitude: Number(t.latitude),
      longitude: Number(t.longitude)
    })),
    shareUrl,
    counts: {
      total,
      completed: wot.filter((t) => t.status === 'COMPLETED').length,
      problem: wot.filter((t) => t.status === 'PROBLEM').length,
      notFound: wot.filter((t) => t.status === 'NOT_FOUND').length
    }
  };
};
