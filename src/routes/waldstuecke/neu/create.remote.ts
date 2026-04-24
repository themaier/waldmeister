import { form, getRequestEvent } from '$app/server';
import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, forestPlotParcels } from '$lib/server/db/schema';
import { resolveParcelIds } from '$lib/server/bayernatlas';

export const createPlot = form(
  z.object({
    name: z.string().trim().max(120).optional(),
    cadastralIds: z
      .array(z.string().min(1))
      .min(1, 'Mindestens ein Flurstück auswählen.')
  }),
  async ({ name, cadastralIds }) => {
    const { locals } = getRequestEvent();
    if (!locals.user) redirect(303, '/login');

    const ids = Array.from(new Set(cadastralIds));
    const resolved = await resolveParcelIds(ids);
    const missing = ids.filter((id) => !resolved.has(id));
    if (missing.length > 0) {
      error(
        400,
        `Flurstück${missing.length === 1 ? '' : 'e'} ${missing.join(', ')} nicht im Cache. Bitte Karte neu laden.`
      );
    }

    const [plot] = await db
      .insert(forestPlots)
      .values({ ownerId: locals.user.id, name: name || null })
      .returning({ id: forestPlots.id });

    await db
      .insert(forestPlotParcels)
      .values(Array.from(resolved.values()).map((parcelId) => ({ plotId: plot.id, parcelId })));

    redirect(303, `/?plot=${plot.id}`);
  }
);
