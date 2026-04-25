<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { activePlotStore } from '$lib/stores/active-plot.svelte';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    if (browser) activePlotStore.hydrate();
  });
</script>

{@render children()}
