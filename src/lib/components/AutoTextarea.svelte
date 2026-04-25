<script lang="ts">
  interface Props {
    value: string;
    initialLines?: number;
    placeholder?: string;
    class?: string;
  }

  let {
    value = $bindable(''),
    initialLines = 2,
    placeholder = '',
    class: className = ''
  }: Props = $props();

  let el = $state<HTMLTextAreaElement | undefined>();

  function resize() {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  $effect(() => {
    void value;
    resize();
  });
</script>

<textarea
  bind:this={el}
  bind:value
  rows={initialLines}
  {placeholder}
  oninput={resize}
  class="w-full px-3 py-2 rounded-btn border bg-surface text-[0.9rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition resize-none overflow-hidden {className}"
></textarea>
