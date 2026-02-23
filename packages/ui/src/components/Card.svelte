<script lang="ts">
  export let title = "";
</script>

<section class="card">
  {#if title}
    <h3>{title}</h3>
  {/if}
  <slot />
</section>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: linear-gradient(170deg, rgba(21, 31, 56, 0.82), rgba(10, 17, 35, 0.82));
    box-shadow: var(--shadow-soft);
    padding: 16px;
  }

  h3 {
    margin: 0 0 12px;
    font-size: 1rem;
  }
</style>
