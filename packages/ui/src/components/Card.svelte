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
    background: var(--surface-elevated);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
    padding: 16px;
  }

  h3 {
    margin: 0 0 12px;
    font-size: 1rem;
  }
</style>
