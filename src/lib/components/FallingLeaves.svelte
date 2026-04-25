<script lang="ts">
  interface Props {
    count?: number;
    class?: string;
  }
  let { count = 18, class: klass = '' }: Props = $props();

  const shapes = [
    'M 12 2 C 6 5, 4 12, 6 18 Q 12 22, 18 18 C 20 12, 18 5, 12 2 Z M 12 4 L 12 21',
    'M 12 2 L 15 8 L 21 9 L 17 14 L 19 21 L 12 17 L 5 21 L 7 14 L 3 9 L 9 8 Z',
    'M 12 2 C 8 8, 8 16, 12 22 C 16 16, 16 8, 12 2 Z M 12 4 L 12 21',
    'M 4 12 C 8 6, 16 6, 20 12 C 16 18, 8 18, 4 12 Z M 4 12 L 20 12'
  ];
  const colors = ['#3d5b30', '#5d7a4a', '#7aa36a', '#8c9d4f', '#c98f2a', '#b65a1f', '#7a5638'];

  function rand(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  const leaves = Array.from({ length: count }, (_, i) => ({
    left: rand(0, 100),
    size: rand(13, 28),
    duration: rand(11, 22),
    delay: -rand(0, 22),
    swayDur: rand(2.6, 5.2),
    swayDelay: -rand(0, 4),
    rotDur: rand(5, 12),
    rotDelay: -rand(0, 8),
    rotDir: i % 2 === 0 ? 1 : -1,
    shape: shapes[i % shapes.length],
    color: colors[i % colors.length],
    opacity: rand(0.45, 0.85)
  }));
</script>

<div class="leaves {klass}" aria-hidden="true">
  {#each leaves as l}
    <span class="fall" style="left: {l.left}%; --dur: {l.duration}s; --delay: {l.delay}s;">
      <span class="sway" style="--swayDur: {l.swayDur}s; --swayDelay: {l.swayDelay}s;">
        <span class="rot" style="--rotDur: {l.rotDur}s; --rotDelay: {l.rotDelay}s; --rotEnd: {l.rotDir * 360}deg;">
          <svg width={l.size} height={l.size} viewBox="0 0 24 24" style="opacity: {l.opacity}; display: block;">
            <path d={l.shape} fill={l.color} stroke="rgba(11, 22, 16, 0.35)" stroke-width="0.6" stroke-linejoin="round" />
          </svg>
        </span>
      </span>
    </span>
  {/each}
</div>

<style>
  .leaves {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .fall {
    position: absolute;
    top: -10%;
    animation: fall var(--dur) linear var(--delay) infinite;
    will-change: transform;
  }
  .sway {
    display: inline-block;
    animation: sway var(--swayDur) ease-in-out var(--swayDelay) infinite alternate;
  }
  .rot {
    display: inline-block;
    animation: rot var(--rotDur) linear var(--rotDelay) infinite;
  }
  @keyframes fall {
    0% {
      transform: translateY(-12vh);
    }
    100% {
      transform: translateY(118vh);
    }
  }
  @keyframes sway {
    0% {
      transform: translateX(-16px);
    }
    100% {
      transform: translateX(16px);
    }
  }
  @keyframes rot {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(var(--rotEnd));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fall,
    .sway,
    .rot {
      animation: none;
    }
  }
</style>
