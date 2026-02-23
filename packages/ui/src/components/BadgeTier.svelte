<script lang="ts">
  type Tier = "SS" | "S" | "A" | "B" | "C" | "D";
  export let tier: Tier = "D";

  const map: Record<Tier, string> = {
    SS: "#35f0ff",
    S: "#4ab6ff",
    A: "#68a2ff",
    B: "#8f88ff",
    C: "#a07bd3",
    D: "#677691"
  };
</script>

<span class="badge" style={`--tier:${map[tier]}`}>{tier}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 22px;
    font-size: 0.78rem;
    font-weight: 700;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--tier), transparent 48%);
    color: var(--tier);
    background: color-mix(in srgb, var(--tier), transparent 86%);
  }
</style>
