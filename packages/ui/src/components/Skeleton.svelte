<script lang="ts">
  export let height = "16px";
  export let width = "100%";
  export let radius = "10px";
</script>

<div class="skeleton" style={`height:${height};width:${width};border-radius:${radius}`}></div>

<style>
  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .skeleton {
    background: linear-gradient(90deg, rgba(6, 23, 46, 0.72), rgba(0, 71, 199, 0.35), rgba(6, 23, 46, 0.72));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
</style>
