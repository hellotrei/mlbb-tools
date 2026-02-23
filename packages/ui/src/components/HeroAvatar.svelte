<script lang="ts">
  export let imageKey = "";
  export let name = "Hero";
  export let size = 36;
  let imageError = false;
  let previousImageKey = "";

  $: if (imageKey !== previousImageKey) {
    previousImageKey = imageKey;
    imageError = false;
  }
</script>

<div class="avatar" style={`width:${size}px;height:${size}px`}>
  {#if imageKey && !imageError}
    <img src={imageKey} alt={name} loading="lazy" on:error={() => (imageError = true)} />
  {:else}
    <span>{name.slice(0, 1)}</span>
  {/if}
</div>

<style>
  .avatar {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: rgba(11, 22, 48, 0.95);
    display: inline-grid;
    place-items: center;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  span {
    color: var(--muted);
    font-weight: 700;
  }
</style>
