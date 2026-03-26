/**
 * TilemapCanvas.js — Main canvas rendering engine
 * SpriteFusion-style: dot grid, deep zoom, ghost preview, pan/zoom, touch gestures.
 */

import { state, on, getActiveLayer, getTileset } from '../state.js';
import { recordAction } from '../history.js';

export class TilemapCanvas {
  constructor(canvasEl, containerEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.container = containerEl;

    // Interaction state
    this.isDrawing = false;
    this.isPanning = false;
    this.lastPanX = 0;
    this.lastPanY = 0;
    this.mouseGridX = -1;
    this.mouseGridY = -1;
    this.lastDrawnKey = '';  // prevent re-drawing same cell
    this.pendingChanges = [];

    // Selection tool state
    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;

    // Fill zone state (bucket drag)
    this.fillStart = null;
    this.fillEnd = null;
    this.isFilling = false;

    // Touch state
    this.lastTouchDist = 0;

    // Space key panning
    this.spaceHeld = false;

    this._bindEvents();
    this._resize();

    // Listen for state changes that need re-render
    on('layers', () => this.render());
    on('gridVisible', () => this.render());
    on('gridColor', () => this.render());
    on('zoom', () => this.render());
    on('tileSize', () => this.render());
    on('selectedTiles', () => this.render());
    on('currentTool', () => { this.clearSelection(); this.render(); });
    on('mapWidth', () => this.render());
    on('mapHeight', () => this.render());
    on('flipH', () => this.render());
    on('flipV', () => this.render());
    on('dragDropPreview', () => this.render());

    document.addEventListener('dragdrop-drop', e => this._onDragDrop(e));

    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  _bindEvents() {
    const c = this.container;

    // Mouse
    c.addEventListener('mousedown', e => this._onPointerDown(e));
    c.addEventListener('mousemove', e => this._onPointerMove(e));
    c.addEventListener('mouseup', e => this._onPointerUp(e));
    c.addEventListener('mouseleave', e => this._onPointerLeave(e));
    c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());

    // Touch
    c.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    c.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
    c.addEventListener('touchend', e => this._onTouchEnd(e));
  }

  // === Coordinate Conversions ===

  screenToWorld(sx, sy) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (sx - rect.left - state.canvasOffsetX) / state.zoom,
      y: (sy - rect.top - state.canvasOffsetY) / state.zoom
    };
  }

  worldToGrid(wx, wy) {
    const ts = state.tileSize;
    return { gx: Math.floor(wx / ts), gy: Math.floor(wy / ts) };
  }

  screenToGrid(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return this.worldToGrid(w.x, w.y);
  }

  // === Mouse Handlers ===

  _onPointerDown(e) {
    // Middle-click or Alt+click or Space held → Pan
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && this.spaceHeld)) {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.container.style.cursor = 'grabbing';
      return;
    }

    // Move tool → pan with left click
    if (e.button === 0 && state.currentTool === 'move') {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.container.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const { gx, gy } = this.screenToGrid(e.clientX, e.clientY);

    // Always update cursor position on down (so ghost preview moves on first tap)
    this.mouseGridX = gx;
    this.mouseGridY = gy;
    const coordsEl = document.getElementById('canvas-coords');
    if (coordsEl) coordsEl.textContent = `${gx}, ${gy}`;

    if (state.currentTool === 'selection') {
      this.isSelecting = true;
      this.selectionStart = { gx, gy };
      this.selectionEnd = { gx, gy };
      this.render();
      return;
    }

    // Bucket fill → drag to define rectangle zone
    if (state.currentTool === 'bucket') {
      this.isFilling = true;
      this.fillStart = { gx, gy };
      this.fillEnd = { gx, gy };
      this.pendingChanges = [];
      this.render();
      return;
    }

    // For pencil/eraser, start drawing immediately
    this.isDrawing = true;
    this.pendingChanges = [];
    this.lastDrawnKey = '';
    this._applyTool(gx, gy);
    this.render();
  }

  _onPointerMove(e) {
    const { gx, gy } = this.screenToGrid(e.clientX, e.clientY);
    this.mouseGridX = gx;
    this.mouseGridY = gy;

    // Update coords display
    const coordsEl = document.getElementById('canvas-coords');
    if (coordsEl) coordsEl.textContent = `${gx}, ${gy}`;

    if (this.isPanning) {
      state.canvasOffsetX += e.clientX - this.lastPanX;
      state.canvasOffsetY += e.clientY - this.lastPanY;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.render();
      return;
    }

    if (this.isSelecting) {
      this.selectionEnd = { gx, gy };
      this.render();
      return;
    }

    if (this.isFilling) {
      this.fillEnd = { gx, gy };
      this.render();
      return;
    }

    if (this.isDrawing) {
      const key = `${gx},${gy}`;
      if (key !== this.lastDrawnKey) {
        this._applyTool(gx, gy);
        this.lastDrawnKey = key;
      }
    }

    this.render();
  }

  _onPointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this._updateCursor();
      return;
    }

    if (this.isSelecting) {
      this.isSelecting = false;
      // Notify toolbar that selection state changed
      document.dispatchEvent(new CustomEvent('selectionchange', {
        detail: { hasSelection: this.hasSelection() }
      }));
      return;
    }

    // Bucket fill: apply fill to the dragged rectangle zone
    if (this.isFilling) {
      this.isFilling = false;
      if (this.fillStart && this.fillEnd) {
        this._applyBucketFill();
      }
      this.fillStart = null;
      this.fillEnd = null;
      this.render();
      return;
    }

    if (this.isDrawing) {
      this.isDrawing = false;
      if (this.pendingChanges.length > 0) {
        recordAction(this.pendingChanges);
        this.pendingChanges = [];
      }
    }
  }

  _onPointerLeave(e) {
    this.mouseGridX = -1;
    this.mouseGridY = -1;
    this.render();
    if (this.isDrawing) {
      this._onPointerUp(e);
    }
  }

  // === Touch Handlers ===

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      this.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      this.isPanning = true;
      this.lastPanX = (t1.clientX + t2.clientX) / 2;
      this.lastPanY = (t1.clientY + t2.clientY) / 2;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onPointerDown({ button: 0, clientX: t.clientX, clientY: t.clientY, altKey: false });
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;

      if (this.lastTouchDist > 0) {
        const scale = dist / this.lastTouchDist;
        const newZoom = Math.min(20, Math.max(0.05, state.zoom * scale));
        state.zoom = Math.round(newZoom * 100) / 100;
      }

      state.canvasOffsetX += midX - this.lastPanX;
      state.canvasOffsetY += midY - this.lastPanY;
      this.lastPanX = midX;
      this.lastPanY = midY;
      this.lastTouchDist = dist;
      this.render();
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onPointerMove({ clientX: t.clientX, clientY: t.clientY });
    }
  }

  _onTouchEnd(e) {
    if (e.touches.length < 2) this.lastTouchDist = 0;
    if (e.touches.length === 0) this._onPointerUp({});
  }

  // === Drag & Drop Placement Handler ===
  _onDragDrop(e) {
    if (state.currentTool !== 'dragdrop') return;
    const { x, y } = e.detail;
    const rect = this.container.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const { gx, gy } = this.screenToGrid(x, y);
      const layer = getActiveLayer();
      if (!layer || !layer.visible) return;
      this.pendingChanges = [];
      this._placeTiles(layer, gx, gy);
      if (this.pendingChanges.length > 0) {
        recordAction(this.pendingChanges);
        this.pendingChanges = [];
        this.render();
      }
    }
  }

  // === Wheel (Zoom) — deep zoom support ===

  _onWheel(e) {
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = state.zoom;
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    // Allow zoom from 0.05x to 20x (very deep zoom)
    const newZoom = Math.min(20, Math.max(0.05, oldZoom * factor));

    // Zoom toward cursor
    state.canvasOffsetX = mouseX - (mouseX - state.canvasOffsetX) * (newZoom / oldZoom);
    state.canvasOffsetY = mouseY - (mouseY - state.canvasOffsetY) * (newZoom / oldZoom);
    state.zoom = Math.round(newZoom * 100) / 100;

    this.render();
  }

  // === Tool Application ===

  _applyTool(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= state.mapWidth || gy >= state.mapHeight) return;

    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    if (state.currentTool === 'pencil') {
      this._placeTiles(layer, gx, gy);
    } else if (state.currentTool === 'eraser') {
      this._eraseTile(layer, gx, gy);
    }
  }

  // === Bucket Fill (drag-to-zone) ===

  _applyBucketFill() {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    const sel = state.selectedTiles;
    if (!sel) return;
    const tileset = getTileset(sel.tilesetId);
    if (!tileset) return;

    const minGX = Math.max(0, Math.min(this.fillStart.gx, this.fillEnd.gx));
    const maxGX = Math.min(state.mapWidth - 1, Math.max(this.fillStart.gx, this.fillEnd.gx));
    const minGY = Math.max(0, Math.min(this.fillStart.gy, this.fillEnd.gy));
    const maxGY = Math.min(state.mapHeight - 1, Math.max(this.fillStart.gy, this.fillEnd.gy));

    const startCol = Math.min(sel.startCol, sel.endCol);
    const startRow = Math.min(sel.startRow, sel.endRow);
    const endCol = Math.max(sel.startCol, sel.endCol);
    const endRow = Math.max(sel.startRow, sel.endRow);
    const selW = endCol - startCol + 1;
    const selH = endRow - startRow + 1;

    this.pendingChanges = [];

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        // Tile the selection pattern across the fill zone
        const col = startCol + ((gx - minGX) % selW);
        const row = startRow + ((gy - minGY) % selH);

        const key = `${gx},${gy}`;
        const oldTile = layer.data[key] || null;
        const newTile = {
          tilesetId: sel.tilesetId,
          col, row,
          flipH: state.flipH,
          flipV: state.flipV
        };

        if (oldTile &&
            oldTile.tilesetId === newTile.tilesetId &&
            oldTile.col === newTile.col &&
            oldTile.row === newTile.row &&
            oldTile.flipH === newTile.flipH &&
            oldTile.flipV === newTile.flipV) continue;

        layer.data[key] = newTile;
        this.pendingChanges.push({ layerId: layer.id, x: gx, y: gy, oldTile, newTile });
      }
    }

    if (this.pendingChanges.length > 0) {
      recordAction(this.pendingChanges);
      this.pendingChanges = [];
      state.layers = [...state.layers];
    }
  }

  _placeTiles(layer, gx, gy) {
    const sel = state.selectedTiles;
    if (!sel) return;

    const tileset = getTileset(sel.tilesetId);
    if (!tileset) return;

    const startCol = Math.min(sel.startCol, sel.endCol);
    const startRow = Math.min(sel.startRow, sel.endRow);
    const endCol = Math.max(sel.startCol, sel.endCol);
    const endRow = Math.max(sel.startRow, sel.endRow);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tx = gx + (col - startCol);
        const ty = gy + (row - startRow);
        if (tx < 0 || ty < 0 || tx >= state.mapWidth || ty >= state.mapHeight) continue;

        const key = `${tx},${ty}`;
        const oldTile = layer.data[key] || null;
        const newTile = {
          tilesetId: sel.tilesetId,
          col, row,
          flipH: state.flipH,
          flipV: state.flipV
        };

        if (oldTile &&
            oldTile.tilesetId === newTile.tilesetId &&
            oldTile.col === newTile.col &&
            oldTile.row === newTile.row &&
            oldTile.flipH === newTile.flipH &&
            oldTile.flipV === newTile.flipV) continue;

        layer.data[key] = newTile;
        this.pendingChanges.push({ layerId: layer.id, x: tx, y: ty, oldTile, newTile });
      }
    }
  }

  _eraseTile(layer, gx, gy) {
    const key = `${gx},${gy}`;
    const oldTile = layer.data[key] || null;
    if (!oldTile) return;
    delete layer.data[key];
    this.pendingChanges.push({ layerId: layer.id, x: gx, y: gy, oldTile, newTile: null });
  }

  // === Selection ===

  hasSelection() {
    return this.selectionStart && this.selectionEnd && state.currentTool === 'selection';
  }

  clearSelection() {
    this.selectionStart = null;
    this.selectionEnd = null;
    document.dispatchEvent(new CustomEvent('selectionchange', { detail: { hasSelection: false } }));
  }

  deleteSelection() {
    if (!this.hasSelection()) return;
    const layer = getActiveLayer();
    if (!layer) return;

    const changes = [];
    const minX = Math.min(this.selectionStart.gx, this.selectionEnd.gx);
    const maxX = Math.max(this.selectionStart.gx, this.selectionEnd.gx);
    const minY = Math.min(this.selectionStart.gy, this.selectionEnd.gy);
    const maxY = Math.max(this.selectionStart.gy, this.selectionEnd.gy);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${y}`;
        const oldTile = layer.data[key] || null;
        if (oldTile) {
          delete layer.data[key];
          changes.push({ layerId: layer.id, x, y, oldTile, newTile: null });
        }
      }
    }

    if (changes.length > 0) {
      recordAction(changes);
      state.layers = [...state.layers];
    }
    this.clearSelection();
    this.render();
  }

  copySelection() {
    if (!this.hasSelection()) return;
    const layer = getActiveLayer();
    if (!layer) return;

    const minX = Math.min(this.selectionStart.gx, this.selectionEnd.gx);
    const maxX = Math.max(this.selectionStart.gx, this.selectionEnd.gx);
    const minY = Math.min(this.selectionStart.gy, this.selectionEnd.gy);
    const maxY = Math.max(this.selectionStart.gy, this.selectionEnd.gy);

    const changes = [];
    const offset = 1; // paste 1 tile down-right

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${y}`;
        const tile = layer.data[key];
        if (!tile) continue;

        const nx = x + offset;
        const ny = y + offset;
        if (nx >= state.mapWidth || ny >= state.mapHeight) continue;

        const destKey = `${nx},${ny}`;
        const oldTile = layer.data[destKey] || null;
        layer.data[destKey] = { ...tile };
        changes.push({ layerId: layer.id, x: nx, y: ny, oldTile, newTile: { ...tile } });
      }
    }

    if (changes.length > 0) {
      recordAction(changes);
      state.layers = [...state.layers];
    }
    this.render();
  }

  // === Rendering ===

  render() {
    const ctx = this.ctx;
    const rect = this.container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Fill entire background with dark color
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(state.canvasOffsetX, state.canvasOffsetY);
    ctx.scale(state.zoom, state.zoom);

    const ts = state.tileSize;
    const mapW = state.mapWidth;
    const mapH = state.mapHeight;

    // Map area background
    ctx.fillStyle = state.gridColor || '#000000';
    ctx.fillRect(0, 0, mapW * ts, mapH * ts);

    // Draw tiles (all visible layers, bottom to top)
    for (const layer of state.layers) {
      if (!layer.visible) continue;
      for (const [key, tile] of Object.entries(layer.data)) {
        const [tx, ty] = key.split(',').map(Number);
        this._drawTile(ctx, tile, tx * ts, ty * ts, ts);
      }
    }

    // Draw grid — SpriteFusion style: subtle dots at intersections + fine lines
    if (state.gridVisible) {
      const lineW = Math.max(0.3, 0.5 / state.zoom);

      // Grid lines — very subtle
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = lineW;

      for (let x = 0; x <= mapW; x++) {
        ctx.beginPath();
        ctx.moveTo(x * ts, 0);
        ctx.lineTo(x * ts, mapH * ts);
        ctx.stroke();
      }
      for (let y = 0; y <= mapH; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * ts);
        ctx.lineTo(mapW * ts, y * ts);
        ctx.stroke();
      }

      // Dots at intersections (only when zoomed in enough to see them)
      if (state.zoom > 0.4) {
        const dotSize = Math.max(0.8, 1.2 / state.zoom);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        for (let x = 0; x <= mapW; x++) {
          for (let y = 0; y <= mapH; y++) {
            ctx.fillRect(x * ts - dotSize / 2, y * ts - dotSize / 2, dotSize, dotSize);
          }
        }
      }
    }

    // Draw ghost preview (pencil only)
    if (this.mouseGridX >= 0 && this.mouseGridY >= 0 &&
        this.mouseGridX < mapW && this.mouseGridY < mapH &&
        !this.isPanning && state.selectedTiles &&
        state.currentTool === 'pencil') {

      const sel = state.selectedTiles;
      const startCol = Math.min(sel.startCol, sel.endCol);
      const startRow = Math.min(sel.startRow, sel.endRow);
      const endCol = Math.max(sel.startCol, sel.endCol);
      const endRow = Math.max(sel.startRow, sel.endRow);

      ctx.globalAlpha = 0.5;
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const px = this.mouseGridX + (col - startCol);
          const py = this.mouseGridY + (row - startRow);
          if (px < 0 || py < 0 || px >= mapW || py >= mapH) continue;

          const ghostTile = {
            tilesetId: sel.tilesetId, col, row,
            flipH: state.flipH, flipV: state.flipV
          };
          this._drawTile(ctx, ghostTile, px * ts, py * ts, ts);
        }
      }
      ctx.globalAlpha = 1;

      // Ghost outline
      const gw = (endCol - startCol + 1) * ts;
      const gh = (endRow - startRow + 1) * ts;
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
      ctx.lineWidth = 1.5 / state.zoom;
      ctx.setLineDash([3 / state.zoom, 3 / state.zoom]);
      ctx.strokeRect(this.mouseGridX * ts, this.mouseGridY * ts, gw, gh);
      ctx.setLineDash([]);
    }

    // Draw ghost preview for dragdrop tool (cross-canvas)
    if (state.dragDropPreview && state.dragDropPreview.active) {
      const { screenX, screenY, tilesetId, col, row, cols, rows } = state.dragDropPreview;
      const crect = this.container.getBoundingClientRect();
      if (screenX >= crect.left && screenX <= crect.right && screenY >= crect.top && screenY <= crect.bottom) {
        const { gx, gy } = this.screenToGrid(screenX, screenY);
        
        ctx.globalAlpha = 0.6;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const px = gx + c;
            const py = gy + r;
            if (px < 0 || py < 0 || px >= mapW || py >= mapH) continue;
            const ghostTile = {
              tilesetId, col: col + c, row: row + r,
              flipH: state.flipH, flipV: state.flipV
            };
            this._drawTile(ctx, ghostTile, px * ts, py * ts, ts);
          }
        }
        ctx.globalAlpha = 1;

        // Outline
        const gw = cols * ts;
        const gh = rows * ts;
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.8)'; // Yellowish to distinguish dragdrop
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
        ctx.strokeRect(gx * ts, gy * ts, gw, gh);
        ctx.setLineDash([]);
      }
    }

    // Bucket fill zone preview (blue rectangle while dragging)
    if (this.isFilling && this.fillStart && this.fillEnd) {
      const fMinX = Math.min(this.fillStart.gx, this.fillEnd.gx);
      const fMaxX = Math.max(this.fillStart.gx, this.fillEnd.gx);
      const fMinY = Math.min(this.fillStart.gy, this.fillEnd.gy);
      const fMaxY = Math.max(this.fillStart.gy, this.fillEnd.gy);

      ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
      ctx.fillRect(fMinX * ts, fMinY * ts, (fMaxX - fMinX + 1) * ts, (fMaxY - fMinY + 1) * ts);
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
      ctx.lineWidth = 2 / state.zoom;
      ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
      ctx.strokeRect(fMinX * ts, fMinY * ts, (fMaxX - fMinX + 1) * ts, (fMaxY - fMinY + 1) * ts);
      ctx.setLineDash([]);
    }

    // Bucket cursor highlight (when not dragging)
    if (this.mouseGridX >= 0 && this.mouseGridY >= 0 &&
        this.mouseGridX < mapW && this.mouseGridY < mapH &&
        state.currentTool === 'bucket' && !this.isFilling && !this.isPanning) {
      ctx.fillStyle = 'rgba(100, 200, 255, 0.12)';
      ctx.fillRect(this.mouseGridX * ts, this.mouseGridY * ts, ts, ts);
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.lineWidth = 1 / state.zoom;
      ctx.strokeRect(this.mouseGridX * ts, this.mouseGridY * ts, ts, ts);
    }

    // Eraser cursor highlight
    if (this.mouseGridX >= 0 && this.mouseGridY >= 0 &&
        this.mouseGridX < mapW && this.mouseGridY < mapH &&
        state.currentTool === 'eraser' && !this.isPanning) {
      ctx.fillStyle = 'rgba(255, 80, 80, 0.2)';
      ctx.fillRect(this.mouseGridX * ts, this.mouseGridY * ts, ts, ts);
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
      ctx.lineWidth = 1.5 / state.zoom;
      ctx.strokeRect(this.mouseGridX * ts, this.mouseGridY * ts, ts, ts);
    }

    // Selection rectangle
    if (this.hasSelection()) {
      const minX = Math.min(this.selectionStart.gx, this.selectionEnd.gx);
      const maxX = Math.max(this.selectionStart.gx, this.selectionEnd.gx);
      const minY = Math.min(this.selectionStart.gy, this.selectionEnd.gy);
      const maxY = Math.max(this.selectionStart.gy, this.selectionEnd.gy);

      ctx.fillStyle = 'rgba(68, 136, 204, 0.15)';
      ctx.fillRect(minX * ts, minY * ts, (maxX - minX + 1) * ts, (maxY - minY + 1) * ts);
      ctx.strokeStyle = 'rgba(68, 136, 204, 0.8)';
      ctx.lineWidth = 1.5 / state.zoom;
      ctx.setLineDash([5 / state.zoom, 3 / state.zoom]);
      ctx.strokeRect(minX * ts, minY * ts, (maxX - minX + 1) * ts, (maxY - minY + 1) * ts);
      ctx.setLineDash([]);
    }

    // Map border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1 / state.zoom;
    ctx.strokeRect(0, 0, mapW * ts, mapH * ts);

    ctx.restore();

    // Update zoom display
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) zoomEl.textContent = Math.round(state.zoom * 100) + '%';
  }

  _drawTile(ctx, tile, x, y, size) {
    const tileset = getTileset(tile.tilesetId);
    if (!tileset || !tileset.image) return;

    const ts = state.tileSize;
    const sx = tile.col * ts;
    const sy = tile.row * ts;

    ctx.save();
    if (tile.flipH || tile.flipV) {
      ctx.translate(x + size / 2, y + size / 2);
      ctx.scale(tile.flipH ? -1 : 1, tile.flipV ? -1 : 1);
      ctx.translate(-(x + size / 2), -(y + size / 2));
    }

    try {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tileset.image, sx, sy, ts, ts, x, y, size, size);
    } catch (e) {
      ctx.fillStyle = '#ff005544';
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }

  // === Cursor ===

  _updateCursor() {
    const tool = state.currentTool;
    if (tool === 'move') this.container.style.cursor = 'grab';
    else if (tool === 'dragdrop') this.container.style.cursor = 'crosshair';
    else if (tool === 'eraser') this.container.style.cursor = 'cell';
    else if (tool === 'selection') this.container.style.cursor = 'crosshair';
    else if (tool === 'bucket') this.container.style.cursor = 'crosshair';
    else this.container.style.cursor = 'crosshair';
  }

  // === Public Methods ===

  centerCanvas() {
    const rect = this.container.getBoundingClientRect();
    const mapPixelW = state.mapWidth * state.tileSize * state.zoom;
    const mapPixelH = state.mapHeight * state.tileSize * state.zoom;
    state.canvasOffsetX = (rect.width - mapPixelW) / 2;
    state.canvasOffsetY = (rect.height - mapPixelH) / 2;
    this.render();
  }

  zoomIn() {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const old = state.zoom;
    const nz = Math.min(20, old * 1.25);
    state.canvasOffsetX = cx - (cx - state.canvasOffsetX) * (nz / old);
    state.canvasOffsetY = cy - (cy - state.canvasOffsetY) * (nz / old);
    state.zoom = Math.round(nz * 100) / 100;
    this.render();
  }

  zoomOut() {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const old = state.zoom;
    const nz = Math.max(0.05, old / 1.25);
    state.canvasOffsetX = cx - (cx - state.canvasOffsetX) * (nz / old);
    state.canvasOffsetY = cy - (cy - state.canvasOffsetY) * (nz / old);
    state.zoom = Math.round(nz * 100) / 100;
    this.render();
  }

  setSpaceHeld(held) {
    this.spaceHeld = held;
    if (held) {
      this.container.style.cursor = 'grab';
    } else {
      this._updateCursor();
    }
  }
}
