import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/login');
  const plotId = url.searchParams.get('plot');
  if (!plotId) throw error(400, 'Waldstück-ID fehlt.');

  const [plot] = await db
    .select({ id: forestPlots.id, name: forestPlots.name })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const acc = url.searchParams.get('acc');

  return {
    plot,
    initial: {
      latitude: lat ? Number(lat) : null,
      longitude: lng ? Number(lng) : null,
      gpsAccuracyM: acc ? Number(acc) : null
    }
  };
};
