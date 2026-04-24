<script lang="ts">
  import type { PageData } from './$types';
  import { ArrowLeft, Tree, MapPin, Camera, Polygon, PencilSimple, Trash } from 'phosphor-svelte';
  import { renamePlot, deletePlot } from '../../plots.remote';

  let { data }: { data: PageData } = $props();

  async function rename() {
    const name = prompt('Name', data.plot.name ?? '');
    if (name === null) return;
    await renamePlot({ id: data.plot.id, name });
    location.reload();
  }

  async function remove() {
    if (!confirm('Waldstück und alle enthaltenen Daten (Bäume, Bereiche, Fotos, Anfahrten) löschen?')) return;
    await deletePlot(data.plot.id);
    location.href = '/';
  }

  const stats = $derived([
    { label: 'Flurstücke', Icon: Polygon, value: data.counts.parcels },
    { label: 'Bäume', Icon: Tree, value: data.counts.trees },
    { label: 'Wege', Icon: MapPin, value: data.counts.routes },
    { label: 'Fotos', Icon: Camera, value: data.counts.photos }
  ]);
</script>

<div class="min-h-dvh bg-earth pb-12">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href="/"
        aria-label="Zurück zur Karte"
        class="w-[38px] h-[38px] min-h-0 grid place-items-center rounded-btn border bg-surface text-ink hover:border-pine transition"
      >
        <ArrowLeft size="1.125em" weight="bold" />
      </a>
      <div class="flex-1 flex flex-col gap-[2px] min-w-0">
        <span class="eyebrow">Waldstück</span>
        <h1
          class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0 truncate"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          {data.plot.name ?? 'Unbenanntes Waldstück'}
        </h1>
      </div>
      <button
        class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-ink text-sm font-semibold hover:border-pine transition"
        onclick={rename}
      >
        <PencilSimple size="1em" /> Umbenennen
      </button>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-5">
    <!-- Editorial stats grid -->
    <section class="grid grid-cols-2 gap-3 sm:gap-4">
      {#each stats as s}
        {@const Icon = s.Icon}
        <div class="relative overflow-hidden paper px-5 pt-5 pb-5 flex flex-col gap-2">
          <span
            class="absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-btn text-pine border border-hairline"
            style="background: color-mix(in srgb, var(--color-pine) 8%, transparent);"
          >
            <Icon size="1.125em" weight="duotone" />
          </span>
          <span class="eyebrow">{s.label}</span>
          <span class="numeral text-[2.5rem] leading-none text-ink">{s.value}</span>
        </div>
      {/each}
    </section>

    <section class="paper px-5 py-5 flex flex-col gap-3">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="01"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Aktionen
      </h2>
      <p class="text-sm text-content-muted leading-relaxed">
        Verwalte dein Waldstück. Das Löschen entfernt alle zugehörigen Daten unwiderruflich.
      </p>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] rounded-btn font-semibold text-sm text-earth border transition hover:-translate-y-px hover:shadow-understory"
        style="background: var(--color-crimson); border-color: color-mix(in srgb, var(--color-crimson) 75%, black);"
        onclick={remove}
      >
        <Trash size="1em" weight="bold" />
        Waldstück löschen
      </button>
    </section>
  </main>
</div>
