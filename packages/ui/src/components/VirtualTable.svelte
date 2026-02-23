<script lang="ts">
  import {
    Virtualizer,
    elementScroll,
    observeElementOffset,
    observeElementRect
  } from "@tanstack/virtual-core";
  import { onMount } from "svelte";
  import type { Column } from "../types";

  type TableRow = Record<string, unknown>;

  export let rows: TableRow[] = [];
  export let columns: Column[] = [];
  export let rowHeight = 52;
  export let height = 560;

  let scrollEl: HTMLDivElement | null = null;
  let virtualizer: Virtualizer<HTMLDivElement, Element> | null = null;
  let virtualItems = [] as ReturnType<Virtualizer<HTMLDivElement, Element>["getVirtualItems"]>;
  let totalSize = 0;

  onMount(() => {
    if (!scrollEl) return;

    virtualizer = new Virtualizer({
      count: rows.length,
      estimateSize: () => rowHeight,
      getScrollElement: () => scrollEl,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      overscan: 8,
      onChange: () => {
        if (!virtualizer) return;
        virtualItems = virtualizer.getVirtualItems();
        totalSize = virtualizer.getTotalSize();
      }
    });

    virtualItems = virtualizer.getVirtualItems();
    totalSize = virtualizer.getTotalSize();
  });

  $: if (virtualizer) {
    virtualizer.setOptions({
      ...virtualizer.options,
      count: rows.length
    });
    virtualItems = virtualizer.getVirtualItems();
    totalSize = virtualizer.getTotalSize();
  }
</script>

<div class="table">
  <div class="head">
    {#each columns as column}
      <div class="cell" style={`width:${column.width ?? 1}px;flex:${column.width ? "0 0 auto" : "1 1 0"};text-align:${column.align ?? "left"}`}>
        {column.header}
      </div>
    {/each}
  </div>
  <div class="body" bind:this={scrollEl} style={`height:${height}px`}>
    <div class="spacer" style={`height:${totalSize}px`}>
      {#each virtualItems as item (item.key)}
        {@const rowData = rows[item.index] ?? {}}
        <div class="row" style={`height:${item.size}px;transform:translateY(${item.start}px)`}>
          {#each columns as column}
            {@const value = rowData[column.key as string]}
            <div class="cell" style={`width:${column.width ?? 1}px;flex:${column.width ? "0 0 auto" : "1 1 0"};text-align:${column.align ?? "left"}`}>
              {#if column.format}
                {column.format(value, rowData)}
              {:else}
                {String(value ?? "-")}
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .table {
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .head {
    display: flex;
    background: rgba(15, 27, 53, 0.9);
    border-bottom: 1px solid var(--border);
  }

  .cell {
    font-size: 0.86rem;
    padding: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .body {
    overflow: auto;
    position: relative;
    background: rgba(8, 14, 29, 0.78);
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  .row {
    width: 100%;
    display: flex;
    position: absolute;
    left: 0;
    top: 0;
    border-bottom: 1px solid rgba(132, 180, 255, 0.12);
    transition: background 160ms ease-out;
  }

  .row:hover {
    background: rgba(43, 77, 145, 0.22);
  }
</style>
