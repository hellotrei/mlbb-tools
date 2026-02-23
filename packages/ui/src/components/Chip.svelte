<script lang="ts">
  export let label = "";
</script>

<span class="chip">{label}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: rgba(14, 24, 46, 0.7);
    color: var(--muted);
    font-size: 0.78rem;
    padding: 4px 10px;
  }
</style>
