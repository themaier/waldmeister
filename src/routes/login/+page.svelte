<script lang="ts">
  import { authClient } from '$lib/auth-client';
  import { goto } from '$app/navigation';
  import { Tree, ArrowRight } from 'phosphor-svelte';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    submitting = true;
    error = null;
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        error = res.error.message ?? 'Anmeldung fehlgeschlagen.';
      } else {
        await goto('/');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unerwarteter Fehler.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="lodge-bg grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] min-h-dvh">
  <!-- Editorial aside -->
  <aside class="hidden lg:flex flex-col gap-8 p-10 relative z-[1] text-earth">
    <div class="flex items-center gap-3">
      <span
        class="w-10 h-10 grid place-items-center rounded-btn text-leaf border"
        style="background: color-mix(in srgb, var(--color-leaf) 22%, transparent); border-color: color-mix(in srgb, var(--color-leaf) 35%, transparent);"
        aria-hidden="true"
      >
        <Tree size="1.5em" weight="fill" />
      </span>
      <span class="font-serif font-semibold text-lg tracking-tight">Waldmeister</span>
    </div>

    <div class="mt-auto flex flex-col gap-3">
      <span class="eyebrow" style="color: color-mix(in srgb, var(--color-earth) 70%, transparent);">
        Digitale Waldverwaltung
      </span>
      <h2
        class="font-serif font-normal text-[clamp(2.5rem,4.2vw,3.75rem)] leading-[0.98] tracking-tight text-earth m-0"
        style="font-variation-settings: 'opsz' 144, 'SOFT' 50, 'WONK' 1;"
      >
        Dein Wald<br /><em class="italic text-leaf" style="font-variation-settings: 'opsz' 144, 'SOFT' 100, 'WONK' 1;">mit einer Karte.</em>
      </h2>
      <p class="max-w-[36ch] text-base leading-relaxed" style="color: color-mix(in srgb, var(--color-earth) 78%, transparent);">
        Bäume vor Ort erfassen, Flurstücke verwalten und Arbeitsaufträge mit einem Link ans Forstunternehmen senden.
      </p>
    </div>

    <dl
      class="grid grid-cols-3 gap-5 pt-5 border-t m-0"
      style="border-color: color-mix(in srgb, var(--color-earth) 20%, transparent);"
    >
      <div>
        <dt class="text-[0.6875rem] font-semibold tracking-caps uppercase mb-1" style="color: color-mix(in srgb, var(--color-earth) 55%, transparent);">
          Forstbesitzer
        </dt>
        <dd class="numeral text-2xl text-earth m-0">1,8 M</dd>
      </div>
      <div>
        <dt class="text-[0.6875rem] font-semibold tracking-caps uppercase mb-1" style="color: color-mix(in srgb, var(--color-earth) 55%, transparent);">
          Waldfläche DE
        </dt>
        <dd class="numeral text-2xl text-earth m-0">11,4 Mha</dd>
      </div>
      <div>
        <dt class="text-[0.6875rem] font-semibold tracking-caps uppercase mb-1" style="color: color-mix(in srgb, var(--color-earth) 55%, transparent);">
          GPS-Genauigkeit
        </dt>
        <dd class="numeral text-2xl text-earth m-0">±5 m</dd>
      </div>
    </dl>

    <p class="font-serif italic text-[0.9375rem]" style="color: color-mix(in srgb, var(--color-earth) 55%, transparent);">
      „Den Wald vor lauter Bäumen sehen — endlich digital.“
    </p>
  </aside>

  <!-- Form -->
  <main class="grid place-items-center p-5 bg-earth relative z-[1]">
    <div class="grain relative w-full max-w-[26rem] bg-surface border rounded-box shadow-canopy px-6 pt-8 pb-5 flex flex-col gap-5 animate-rise">
      <div
        class="absolute -top-5 left-1/2 -translate-x-1/2 w-12 h-12 grid place-items-center rounded-btn text-ember border shadow-understory"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        aria-hidden="true"
      >
        <Tree size="1.5em" weight="fill" />
      </div>

      <div class="text-center flex flex-col gap-1 mt-3">
        <span class="eyebrow">Anmeldung</span>
        <h1
          class="font-serif font-normal text-[1.75rem] leading-tight tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 144, 'SOFT' 40, 'WONK' 1;"
        >
          Willkommen zurück.
        </h1>
        <p class="text-content-muted text-sm">Melde dich an, um deine Wälder zu verwalten.</p>
      </div>

      <form onsubmit={submit} class="flex flex-col gap-4">
        <label class="flex flex-col gap-2">
          <span class="text-[0.8125rem] font-semibold text-content">E-Mail</span>
          <input
            type="email"
            class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink transition focus:outline-none focus:border-pine focus:shadow-ring-focus"
            autocomplete="email"
            required
            bind:value={email}
            placeholder="name@beispiel.de"
          />
        </label>

        <label class="flex flex-col gap-2">
          <span class="flex justify-between items-baseline text-[0.8125rem] font-semibold text-content">
            Passwort
            <a href="#forgot" class="text-xs text-content-muted no-underline hover:text-pine hover:underline">vergessen?</a>
          </span>
          <input
            type="password"
            class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink transition focus:outline-none focus:border-pine focus:shadow-ring-focus"
            autocomplete="current-password"
            required
            minlength="8"
            bind:value={password}
          />
        </label>

        {#if error}
          <div class="alert alert-error text-sm" role="alert">{error}</div>
        {/if}

        <button
          class="inline-flex items-center justify-between gap-3 px-5 py-3 min-h-[52px] rounded-btn text-earth border font-semibold text-[0.9375rem] shadow-understory transition hover:-translate-y-px hover:shadow-canopy disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
          disabled={submitting}
        >
          <span>{submitting ? 'Anmelden …' : 'Anmelden'}</span>
          <ArrowRight size="1.125em" weight="bold" />
        </button>
      </form>

      <div class="flex flex-col gap-3 text-center text-content-muted text-[0.8125rem]">
        <span class="hairline" aria-hidden="true"></span>
        <p>
          Noch kein Konto? <a href="/register" class="text-pine font-semibold no-underline hover:underline">Kostenlos registrieren</a>
        </p>
      </div>
    </div>
  </main>
</div>
