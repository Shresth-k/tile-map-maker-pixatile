/**
 * exporters.js — Export tilemap as PNG or JSON
 */

import { state, getTileset } from '../state.js';

/**
 * Export all visible layers composited as a PNG image.
 */
export function exportPNG() {
  const ts = state.tileSize;
  const w = state.mapWidth * ts;
  const h = state.mapHeight * ts;

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d');

  // Draw each visible layer
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const [key, tile] of Object.entries(layer.data)) {
      const [tx, ty] = key.split(',').map(Number);
      const tileset = getTileset(tile.tilesetId);
      if (!tileset || !tileset.image) continue;

      const sx = tile.col * ts;
      const sy = tile.row * ts;
      const dx = tx * ts;
      const dy = ty * ts;

      ctx.save();
      if (tile.flipH || tile.flipV) {
        ctx.translate(dx + ts / 2, dy + ts / 2);
        ctx.scale(tile.flipH ? -1 : 1, tile.flipV ? -1 : 1);
        ctx.translate(-(dx + ts / 2), -(dy + ts / 2));
      }
      ctx.drawImage(tileset.image, sx, sy, ts, ts, dx, dy, ts, ts);
      ctx.restore();
    }
  }

  offscreen.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * Export project data as JSON.
 */
export function exportJSON() {
  const data = {
    name: state.projectName,
    tileSize: state.tileSize,
    mapWidth: state.mapWidth,
    mapHeight: state.mapHeight,
    layers: state.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      tiles: Object.entries(layer.data).map(([key, tile]) => {
        const [x, y] = key.split(',').map(Number);
        return {
          x, y,
          tilesetId: tile.tilesetId,
          col: tile.col,
          row: tile.row,
          flipH: tile.flipH || false,
          flipV: tile.flipV || false
        };
      })
    })),
    tilesets: state.tilesets.map(ts => ({
      id: ts.id,
      name: ts.name,
      cols: ts.cols,
      rows: ts.rows,
      width: ts.width,
      height: ts.height,
      dataURL: ts.dataURL
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.projectName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
