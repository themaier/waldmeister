import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, parcels, forestPlotParcels } from '$lib/server/db/schema';
import { geomToGeoJson } from '$lib/server/db/geo';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
  const plotId = url.searchParams.get('plot');
  if (!plotId) throw error(400, 'Waldstück-ID fehlt.');

  const [plot] = await db
    .select({ id: forestPlots.id, name: forestPlots.name })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, plotId), eq(forestPlots.ownerId, locals.user!.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const parcelRows = await db
    .select({
      id: parcels.id,
      plotId: forestPlotParcels.plotId,
      cadastralId: parcels.cadastralId,
      geometry: geomToGeoJson(parcels.geometry).as('geometry')
    })
    .from(forestPlotParcels)
    .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
    .where(eq(forestPlotParcels.plotId, plot.id));

  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const acc = url.searchParams.get('acc');

  return {
    plot,
    plotParcels: parcelRows.map((r) => ({
      id: r.id,
      plotId: r.plotId,
      cadastralId: r.cadastralId,
      geometry: typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry
    })),
    initial: {
      latitude: lat ? Number(lat) : null,
      longitude: lng ? Number(lng) : null,
      gpsAccuracyM: acc ? Number(acc) : null
    }
  };
};
