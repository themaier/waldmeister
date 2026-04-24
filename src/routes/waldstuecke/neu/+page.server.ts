import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, forestPlotParcels } from '$lib/server/db/schema';
import { z } from 'zod';
import { resolveParcelIds } from '$lib/server/bayernatlas';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return {};
};

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  // The client only sends cadastralIds — geometries live in the parcels cache,
  // which was populated by `parcelsInBbox` as the user explored the map.
  cadastralIds: z.array(z.string().min(1)).min(1, 'Mindestens ein Flurstück auswählen.')
});

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, '/login');

    const form = await request.formData();
    const raw = form.get('payload');
    if (typeof raw !== 'string') return fail(400, { error: 'Ungültige Eingabe.' });

    let parsed;
    try {
      parsed = schema.parse(JSON.parse(raw));
    } catch (err) {
      return fail(400, { error: err instanceof z.ZodError ? err.errors[0].message : 'Ungültige Eingabe.' });
    }

    const ids = Array.from(new Set(parsed.cadastralIds));
    const resolved = await resolveParcelIds(ids);
    const missing = ids.filter((id) => !resolved.has(id));
    if (missing.length > 0) {
      return fail(400, { error: `Flurstück${missing.length === 1 ? '' : 'e'} ${missing.join(', ')} nicht im Cache. Bitte Karte neu laden.` });
    }

    const [plot] = await db
      .insert(forestPlots)
      .values({ ownerId: locals.user.id, name: parsed.name || null })
      .returning({ id: forestPlots.id });

    await db
      .insert(forestPlotParcels)
      .values(ids.map((cid) => ({ plotId: plot.id, parcelId: resolved.get(cid)! })));

    throw redirect(303, `/?plot=${plot.id}`);
  }
};
