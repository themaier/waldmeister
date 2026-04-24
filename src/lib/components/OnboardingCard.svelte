<script lang="ts">
  // §5.2 empty-state onboarding card.
  // Editorial, welcoming, with serifed step numerals and a glowing CTA so a
  // first-time user on a blank map immediately sees where to go.
  import { TreeStructure, MapPinSimpleArea, ShareNetwork, ArrowRight } from 'phosphor-svelte';

  interface Props {
    onCreate: () => void;
  }
  let { onCreate }: Props = $props();

  const steps = [
    {
      num: '01',
      Icon: TreeStructure,
      title: 'Waldstück anlegen',
      desc: 'Wähle deine Flurstücke direkt auf der Karte.'
    },
    {
      num: '02',
      Icon: MapPinSimpleArea,
      title: 'Bäume erfassen',
      desc: 'Foto + GPS pro Baum — vor Ort oder per Langdruck auf die Karte.'
    },
    {
      num: '03',
      Icon: ShareNetwork,
      title: 'Auftrag teilen',
      desc: 'Ein Link an dein Forstunternehmen — fertig.'
    }
  ];
</script>

<div
  class="grain pointer-events-auto relative w-full max-w-[30rem] bg-surface border rounded-sheet shadow-canopy px-6 pt-6 pb-5 flex flex-col gap-5 overflow-hidden animate-rise"
>
  <div
    class="absolute top-0 left-0 right-0 h-1"
    style="background: linear-gradient(90deg, var(--color-moss), var(--color-leaf), var(--color-ember));"
    aria-hidden="true"
  ></div>

  <header class="flex flex-col gap-3">
    <span class="eyebrow">Willkommen · Erster Schritt</span>
    <h2
      class="font-serif font-normal text-[clamp(1.75rem,4vw,2.375rem)] leading-[1.02] tracking-tight text-ink m-0"
      style="font-variation-settings: 'opsz' 144, 'SOFT' 50, 'WONK' 1;"
    >
      Dein <em class="italic text-pine" style="font-variation-settings: 'opsz' 144, 'SOFT' 100, 'WONK' 1;">digitaler</em> Wald<br />beginnt hier.
    </h2>
    <p class="text-content-muted text-[0.9375rem] leading-relaxed max-w-[28rem]">
      Lege ein Waldstück an, erfasse Bäume vor Ort und sende fertige Aufträge an dein Forstunternehmen — alles von einem Ort aus.
    </p>
  </header>

  <hr class="border-0 h-px bg-hairline" />

  <ol class="list-none p-0 m-0 flex flex-col gap-4">
    {#each steps as s}
      {@const Icon = s.Icon}
      <li class="grid grid-cols-[auto_auto_1fr] items-start gap-4">
        <span
          class="font-serif italic text-ember leading-tight pt-[2px] text-[1.125rem]"
          style="font-variation-settings: 'opsz' 144, 'SOFT' 60, 'WONK' 1;"
          aria-hidden="true"
        >
          {s.num}
        </span>
        <span class="w-9 h-9 grid place-items-center rounded-btn text-pine border border-hairline" style="background: color-mix(in srgb, var(--color-pine) 10%, transparent);">
          <Icon size="1.375em" weight="duotone" />
        </span>
        <div class="flex flex-col gap-[2px] pt-1">
          <p class="font-serif font-medium text-ink text-base tracking-tight">{s.title}</p>
          <p class="text-content-muted text-sm leading-snug">{s.desc}</p>
        </div>
      </li>
    {/each}
  </ol>

  <button
    class="w-full inline-flex items-center justify-between gap-3 px-5 py-3 min-h-[52px] rounded-btn text-earth border font-semibold text-[0.9375rem] shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
    style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
    onclick={onCreate}
  >
    <span>Neues Waldstück erstellen</span>
    <ArrowRight size="1.125em" weight="bold" />
  </button>
</div>
