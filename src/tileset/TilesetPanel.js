/**
 * TilesetPanel.js - Full canvas workspace for tileset management
 *
 * Each workspace is a separate asset canvas that can contain its own
 * organized list of tileset images. Tile assets remain global so map data,
 * export, and history continue to work across workspaces.
 */

import { state, on, getTileset, getActiveTilesetWorkspace } from '../state.js';

let nextTilesetId = 1;
let nextWorkspaceId = 2;

export class TilesetPanel {
  constructor() {
    this.dropzone = document.getElementById('tileset-dropzone');
    this.canvasWrap = document.getElementById('tileset-canvas-wrap');
    this.canvas = document.getElementById('tileset-canvas');
    this.selCanvas = document.getElementById('tileset-selection-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.selCtx = this.selCanvas.getContext('2d');
    this.addBtn = document.getElementById('add-tileset-btn');
    this.fileInput = document.getElementById('tileset-file-input');
    this.toolbar = document.getElementById('tileset-toolbar');
    this.workspaceBtn = document.getElementById('tileset-workspace-btn');
    this.workspaceMenu = document.getElementById('tileset-workspace-menu');
    this.workspaceList = document.getElementById('tileset-workspace-list');
    this.workspaceCreateBtn = document.getElementById('tileset-workspace-create');
    this.workspaceName = document.getElementById('tileset-workspace-name');

    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;
    this.mode = 'select';
    this.isPanning = false;
    this.lastPanX = 0;
    this.lastPanY = 0;
    this.isDragging = false;
    this.dragStart = null;
    this.dragEnd = null;
    this.isMovingSelection = false;
    this.moveStartPos = null;
    this.originalSelection = null;
    this.lastTouchDist = 0;
    this.tilesetPositions = new Map();
    this.hoveredTilesetId = null;
    this.workspaceViews = new Map();

    this._ensureWorkspaceState();
    this._bindEvents();
    this._bindToolbar();
    this._bindWorkspaceSwitcher();

    on('tileSize', () => {
      this._layoutTilesets();
      this._render();
    });
    on('tilesets', () => this.refreshUI({ preserveView: true }));
    on('tilesetWorkspaces', () => this.refreshUI({ preserveView: true }));
    on('activeTilesetWorkspaceId', (_next, prev) => {
      this._storeWorkspaceView(prev);
      this.refreshUI();
    });
    on('selectedTiles', () => this._render());

    this.refreshUI();
  }

  refreshUI({ preserveView = false } = {}) {
    this._ensureWorkspaceState();
    this._syncSelectionToWorkspace();
    this._renderWorkspaceMenu();
    this._updateWorkspaceLabel();
    this._updateToolbarActive();
    this._updateCursor();

    const workspaceTilesets = this._getWorkspaceTilesets();
    this.dropzone.style.display = workspaceTilesets.length === 0 ? 'flex' : 'none';
    this.canvasWrap.style.display = workspaceTilesets.length > 0 ? 'block' : 'none';
    if (this.toolbar) this.toolbar.style.display = 'flex';

    if (workspaceTilesets.length === 0) {
      this._clearCanvases();
      return;
    }

    this._resizeCanvases();
    this._layoutTilesets();
    if (preserveView && this.workspaceViews.has(state.activeTilesetWorkspaceId)) {
      const view = this.workspaceViews.get(state.activeTilesetWorkspaceId);
      this.offsetX = view.offsetX;
      this.offsetY = view.offsetY;
      this.zoom = view.zoom;
    } else {
      this._centerView();
    }
    this._render();
  }

  _ensureWorkspaceState() {
    if (!Array.isArray(state.tilesetWorkspaces) || state.tilesetWorkspaces.length === 0) {
      state.tilesetWorkspaces = [{ id: 'tsw_1', name: 'Canvas 1', tilesetIds: [] }];
    }

    if (!state.activeTilesetWorkspaceId || !state.tilesetWorkspaces.some(w => w.id === state.activeTilesetWorkspaceId)) {
      state.activeTilesetWorkspaceId = state.tilesetWorkspaces[0].id;
    }

    const highest = state.tilesetWorkspaces.reduce((max, workspace) => {
      const match = /tsw_(\d+)/.exec(workspace.id);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 1);
    nextWorkspaceId = Math.max(nextWorkspaceId, highest + 1);

    const tilesetHighest = state.tilesets.reduce((max, tileset) => {
      const match = /ts_(\d+)/.exec(tileset.id);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0);
    nextTilesetId = Math.max(nextTilesetId, tilesetHighest + 1);
  }

  _getActiveWorkspace() {
    return getActiveTilesetWorkspace();
  }

  _getWorkspaceTilesets() {
    const workspace = this._getActiveWorkspace();
    if (!workspace) return [];
    return workspace.tilesetIds
      .map(id => getTileset(id))
      .filter(Boolean);
  }

  _workspaceContainsTileset(tilesetId) {
    const workspace = this._getActiveWorkspace();
    return !!workspace?.tilesetIds.includes(tilesetId);
  }

  _storeWorkspaceView(workspaceId = state.activeTilesetWorkspaceId) {
    if (!workspaceId) return;
    this.workspaceViews.set(workspaceId, {
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      zoom: this.zoom
    });
  }

  _syncSelectionToWorkspace() {
    const workspaceTilesets = this._getWorkspaceTilesets();
    const firstTileset = workspaceTilesets[0] || null;

    if (state.activeTilesetId && !this._workspaceContainsTileset(state.activeTilesetId)) {
      state.activeTilesetId = firstTileset?.id || null;
    }

    if (state.selectedTiles && !this._workspaceContainsTileset(state.selectedTiles.tilesetId)) {
      state.selectedTiles = null;
    }
  }

  _bindEvents() {
    this.dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      this.dropzone.classList.add('drag-over');
    });
    this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('drag-over'));
    this.dropzone.addEventListener('drop', e => {
      e.preventDefault();
      this.dropzone.classList.remove('drag-over');
      this._importFiles(e.dataTransfer.files);
    });
    this.dropzone.addEventListener('click', () => this.fileInput.click());
    this.addBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', e => {
      this._importFiles(e.target.files);
      e.target.value = '';
    });

    this.canvasWrap.addEventListener('dragover', e => {
      e.preventDefault();
      this.canvasWrap.style.outline = '2px solid #5a8a5a';
    });
    this.canvasWrap.addEventListener('dragleave', () => {
      this.canvasWrap.style.outline = '';
    });
    this.canvasWrap.addEventListener('drop', e => {
      e.preventDefault();
      this.canvasWrap.style.outline = '';
      this._importFiles(e.dataTransfer.files);
    });

    document.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (blob) this._loadTilesetFromFile(blob);
        break;
      }
    });

    this.selCanvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.selCanvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.selCanvas.addEventListener('mouseup', e => this._onMouseUp(e));
    this.selCanvas.addEventListener('mouseleave', e => this._onMouseUp(e));
    this.selCanvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    this.selCanvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._showContextMenu(e.clientX, e.clientY);
    });

    this.selCanvas.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    this.selCanvas.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
    this.selCanvas.addEventListener('touchend', e => this._onTouchEnd(e));
  }

  _bindToolbar() {
    if (!this.toolbar) return;
    this.toolbar.querySelectorAll('[data-ts-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tsTool;
        if (tool === 'pan') this.mode = 'pan';
        else if (tool === 'select') this.mode = 'select';
        else if (tool === 'zoom-in') this._zoomAt(1.3, null);
        else if (tool === 'zoom-out') this._zoomAt(0.7, null);
        else if (tool === 'delete') this._deleteHoveredTileset();
        this._updateToolbarActive();
        this._updateCursor();
      });
    });
  }

  _bindWorkspaceSwitcher() {
    if (!this.workspaceBtn || !this.workspaceMenu) return;

    this.workspaceBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.workspaceMenu.classList.toggle('open');
    });

    this.workspaceCreateBtn?.addEventListener('click', () => {
      this._createWorkspace();
    });

    document.addEventListener('mousedown', e => {
      if (!this.workspaceMenu.classList.contains('open')) return;
      if (this.workspaceMenu.contains(e.target) || this.workspaceBtn.contains(e.target)) return;
      this.workspaceMenu.classList.remove('open');
    });
  }

  _renderWorkspaceMenu() {
    if (!this.workspaceList) return;
    this.workspaceList.innerHTML = '';

    state.tilesetWorkspaces.forEach(workspace => {
      const row = document.createElement('div');
      row.className = 'tileset-workspace-menu__row';

      const count = workspace.tilesetIds.length;
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'tileset-workspace-menu__item';
      selectBtn.classList.toggle('active', workspace.id === state.activeTilesetWorkspaceId);
      selectBtn.innerHTML = `
        <span class="tileset-workspace-menu__item-name">${workspace.name}</span>
        <span class="tileset-workspace-menu__item-meta">${count} asset${count === 1 ? '' : 's'}</span>
      `;
      selectBtn.addEventListener('click', () => {
        this.workspaceMenu.classList.remove('open');
        if (workspace.id !== state.activeTilesetWorkspaceId) {
          state.activeTilesetWorkspaceId = workspace.id;
        }
      });

      row.appendChild(selectBtn);

      if (state.tilesetWorkspaces.length > 1) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'tileset-workspace-menu__delete';
        deleteBtn.title = `Delete ${workspace.name}`;
        deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.addEventListener('click', e => {
          e.stopPropagation();
          this._deleteWorkspace(workspace.id);
        });
        row.appendChild(deleteBtn);
      }

      this.workspaceList.appendChild(row);
    });
  }

  _updateWorkspaceLabel() {
    if (!this.workspaceName) return;
    const workspace = this._getActiveWorkspace();
    this.workspaceName.textContent = workspace?.name || 'Canvas 1';
  }

  _createWorkspace() {
    this._storeWorkspaceView();
    const workspace = {
      id: `tsw_${nextWorkspaceId++}`,
      name: `Canvas ${state.tilesetWorkspaces.length + 1}`,
      tilesetIds: []
    };
    state.tilesetWorkspaces = [...state.tilesetWorkspaces, workspace];
    state.activeTilesetWorkspaceId = workspace.id;
    this.workspaceMenu.classList.remove('open');
  }

  _deleteWorkspace(workspaceId) {
    const workspace = state.tilesetWorkspaces.find(entry => entry.id === workspaceId);
    if (!workspace || state.tilesetWorkspaces.length <= 1) return;

    const assetCount = workspace.tilesetIds.length;
    const message = assetCount > 0
      ? `Delete "${workspace.name}"?\n\nThis will also remove its ${assetCount} tileset asset${assetCount === 1 ? '' : 's'} and any placed tiles that use them.`
      : `Delete "${workspace.name}"?`;
    if (!confirm(message)) return;

    for (const tilesetId of workspace.tilesetIds) {
      this._removeTileset(tilesetId, { skipRefresh: true, skipWorkspaceUpdate: true });
    }

    const remainingWorkspaces = state.tilesetWorkspaces.filter(entry => entry.id !== workspaceId);
    this.workspaceViews.delete(workspaceId);
    state.tilesetWorkspaces = remainingWorkspaces;

    if (state.activeTilesetWorkspaceId === workspaceId) {
      state.activeTilesetWorkspaceId = remainingWorkspaces[0]?.id || null;
    }

    this.workspaceMenu.classList.remove('open');
    this.refreshUI();
  }

  _updateToolbarActive() {
    if (!this.toolbar) return;
    this.toolbar.querySelectorAll('[data-ts-tool]').forEach(btn => {
      const tool = btn.dataset.tsTool;
      btn.classList.toggle('active', tool === this.mode && (tool === 'pan' || tool === 'select'));
    });
  }

  _updateCursor() {
    if (!this.canvasWrap) return;
    if (this.mode === 'pan') {
      this.canvasWrap.style.cursor = this.isPanning ? 'grabbing' : 'grab';
    } else {
      this.canvasWrap.style.cursor = 'crosshair';
    }
  }

  _importFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) this._loadTilesetFromFile(file);
    }
  }

  _loadTilesetFromFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ts = state.tileSize;
        const cols = Math.floor(img.width / ts);
        const rows = Math.floor(img.height / ts);
        if (cols <= 0 || rows <= 0) {
          alert(`Image too small for tile size ${ts}x${ts}`);
          return;
        }

        const tileset = {
          id: `ts_${nextTilesetId++}`,
          name: file.name || 'Tileset',
          image: img,
          dataURL: e.target.result,
          cols,
          rows,
          width: img.width,
          height: img.height
        };

        state.tilesets = [...state.tilesets, tileset];

        const workspace = this._getActiveWorkspace();
        const updatedWorkspaces = state.tilesetWorkspaces.map(entry => (
          entry.id === workspace.id
            ? { ...entry, tilesetIds: [...entry.tilesetIds, tileset.id] }
            : entry
        ));
        state.tilesetWorkspaces = updatedWorkspaces;
        state.activeTilesetId = tileset.id;
        state.selectedTiles = {
          tilesetId: tileset.id,
          startCol: 0,
          startRow: 0,
          endCol: 0,
          endRow: 0
        };

        this.workspaceViews.delete(workspace.id);
        this.refreshUI();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _resizeCanvases() {
    const rect = this.canvasWrap.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.selCanvas.width = w;
    this.selCanvas.height = h;
    this.selCanvas.style.width = `${w}px`;
    this.selCanvas.style.height = `${h}px`;
    this._render();
  }

  _layoutTilesets() {
    this.tilesetPositions.clear();
    const ts = state.tileSize;
    let currentY = 0;

    for (const tileset of this._getWorkspaceTilesets()) {
      this.tilesetPositions.set(tileset.id, { x: 0, y: currentY });
      currentY += tileset.rows * ts + ts;
    }
  }

  _centerView() {
    const tilesets = this._getWorkspaceTilesets();
    if (tilesets.length === 0) return;

    const rect = this.canvasWrap.getBoundingClientRect();
    const ts = state.tileSize;
    let maxW = 0;
    let maxH = 0;

    for (const tileset of tilesets) {
      const pos = this.tilesetPositions.get(tileset.id);
      if (!pos) continue;
      maxW = Math.max(maxW, pos.x + tileset.cols * ts);
      maxH = Math.max(maxH, pos.y + tileset.rows * ts);
    }

    const padW = rect.width * 0.9;
    const padH = rect.height * 0.9;
    this.zoom = Math.min(padW / Math.max(maxW, ts), padH / Math.max(maxH, ts), 3);
    this.zoom = Math.max(0.1, this.zoom);
    this.offsetX = (rect.width - maxW * this.zoom) / 2;
    this.offsetY = (rect.height - maxH * this.zoom) / 2;
  }

  _screenToWorld(sx, sy) {
    const rect = this.canvasWrap.getBoundingClientRect();
    return {
      wx: (sx - rect.left - this.offsetX) / this.zoom,
      wy: (sy - rect.top - this.offsetY) / this.zoom
    };
  }

  _worldToTile(wx, wy) {
    const ts = state.tileSize;
    for (const tileset of this._getWorkspaceTilesets()) {
      const pos = this.tilesetPositions.get(tileset.id);
      if (!pos) continue;
      const lx = wx - pos.x;
      const ly = wy - pos.y;
      const gridW = tileset.cols * ts;
      const gridH = tileset.rows * ts;
      if (lx >= 0 && lx < gridW && ly >= 0 && ly < gridH) {
        return {
          tilesetId: tileset.id,
          col: Math.floor(lx / ts),
          row: Math.floor(ly / ts)
        };
      }
    }
    return null;
  }

  _hitTestTileset(wx, wy) {
    const ts = state.tileSize;
    for (const tileset of this._getWorkspaceTilesets()) {
      const pos = this.tilesetPositions.get(tileset.id);
      if (!pos) continue;
      const lx = wx - pos.x;
      const ly = wy - pos.y;
      if (lx >= 0 && lx < tileset.cols * ts && ly >= 0 && ly < tileset.rows * ts) {
        return tileset.id;
      }
    }
    return null;
  }

  _onMouseDown(e) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.mode === 'pan')) {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.canvasWrap.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const { wx, wy } = this._screenToWorld(e.clientX, e.clientY);
    const tile = this._worldToTile(wx, wy);
    if (!tile) return;

    if (state.currentTool === 'dragdrop') {
      let draggedSel = null;
      const sel = state.selectedTiles;
      if (sel && sel.tilesetId === tile.tilesetId) {
        const minC = Math.min(sel.startCol, sel.endCol);
        const maxC = Math.max(sel.startCol, sel.endCol);
        const minR = Math.min(sel.startRow, sel.endRow);
        const maxR = Math.max(sel.startRow, sel.endRow);
        if (tile.col >= minC && tile.col <= maxC && tile.row >= minR && tile.row <= maxR) {
          draggedSel = sel;
        }
      }

      if (draggedSel) {
        this._startGlobalDragDrop(e, draggedSel);
        this._render();
        return;
      }
    }

    const sel = state.selectedTiles;
    if (sel && sel.tilesetId === tile.tilesetId) {
      const minC = Math.min(sel.startCol, sel.endCol);
      const maxC = Math.max(sel.startCol, sel.endCol);
      const minR = Math.min(sel.startRow, sel.endRow);
      const maxR = Math.max(sel.startRow, sel.endRow);
      if (tile.col >= minC && tile.col <= maxC && tile.row >= minR && tile.row <= maxR) {
        this.isMovingSelection = true;
        this.moveStartPos = tile;
        this.originalSelection = { ...sel };
        return;
      }
    }

    this.isDragging = true;
    this.dragStart = tile;
    this.dragEnd = tile;
    state.activeTilesetId = tile.tilesetId;
    state.selectedTiles = {
      tilesetId: tile.tilesetId,
      startCol: tile.col,
      startRow: tile.row,
      endCol: tile.col,
      endRow: tile.row
    };
    this._render();
  }

  _onMouseMove(e) {
    const { wx, wy } = this._screenToWorld(e.clientX, e.clientY);
    this.hoveredTilesetId = this._hitTestTileset(wx, wy);

    if (this.isPanning) {
      this.offsetX += e.clientX - this.lastPanX;
      this.offsetY += e.clientY - this.lastPanY;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this._storeWorkspaceView();
      this._render();
      return;
    }

    if (this.isMovingSelection && this.originalSelection) {
      const tile = this._worldToTile(wx, wy);
      if (tile && tile.tilesetId === this.originalSelection.tilesetId) {
        const dCol = tile.col - this.moveStartPos.col;
        const dRow = tile.row - this.moveStartPos.row;
        const tileset = getTileset(tile.tilesetId);
        if (tileset) {
          const w = Math.abs(this.originalSelection.endCol - this.originalSelection.startCol);
          const h = Math.abs(this.originalSelection.endRow - this.originalSelection.startRow);
          const minCol = Math.min(this.originalSelection.startCol, this.originalSelection.endCol);
          const minRow = Math.min(this.originalSelection.startRow, this.originalSelection.endRow);

          const newMinCol = Math.max(0, Math.min(tileset.cols - 1 - w, minCol + dCol));
          const newMinRow = Math.max(0, Math.min(tileset.rows - 1 - h, minRow + dRow));

          state.selectedTiles = {
            ...this.originalSelection,
            startCol: newMinCol,
            startRow: newMinRow,
            endCol: newMinCol + w,
            endRow: newMinRow + h
          };
          this._render();
        }
      }
      return;
    }

    if (this.isDragging && this.dragStart) {
      const tile = this._worldToTile(wx, wy);
      if (tile && tile.tilesetId === this.dragStart.tilesetId) {
        this.dragEnd = tile;
        state.selectedTiles = {
          tilesetId: this.dragStart.tilesetId,
          startCol: this.dragStart.col,
          startRow: this.dragStart.row,
          endCol: tile.col,
          endRow: tile.row
        };
        this._render();
      }
    }
  }

  _onMouseUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this._updateCursor();
    }
    this.isDragging = false;
    this.isMovingSelection = false;
  }

  _startGlobalDragDrop(startEvent, sel) {
    let startX;
    let startY;
    if (startEvent.touches && startEvent.touches.length > 0) {
      startX = startEvent.touches[0].clientX;
      startY = startEvent.touches[0].clientY;
    } else if (startEvent.changedTouches && startEvent.changedTouches.length > 0) {
      startX = startEvent.changedTouches[0].clientX;
      startY = startEvent.changedTouches[0].clientY;
    } else {
      startX = startEvent.clientX;
      startY = startEvent.clientY;
    }

    const tileset = getTileset(sel.tilesetId);
    if (!tileset) return;

    const cols = Math.abs(sel.endCol - sel.startCol) + 1;
    const rows = Math.abs(sel.endRow - sel.startRow) + 1;
    const isTouch = startEvent.type && startEvent.type.startsWith('touch');
    const yOffset = isTouch ? -50 : 0;

    state.dragDropPreview = {
      active: true,
      screenX: startX,
      screenY: startY + yOffset,
      tilesetId: sel.tilesetId,
      col: Math.min(sel.startCol, sel.endCol),
      row: Math.min(sel.startRow, sel.endRow),
      cols,
      rows
    };

    const onMove = tev => {
      let cx;
      let cy;
      if (tev.touches && tev.touches.length > 0) {
        cx = tev.touches[0].clientX;
        cy = tev.touches[0].clientY;
      } else {
        cx = tev.clientX;
        cy = tev.clientY;
      }
      state.dragDropPreview = { ...state.dragDropPreview, screenX: cx, screenY: cy + yOffset };
    };

    const onUp = tev => {
      let cx;
      let cy;
      if (tev.changedTouches && tev.changedTouches.length > 0) {
        cx = tev.changedTouches[0].clientX;
        cy = tev.changedTouches[0].clientY;
      } else {
        cx = tev.clientX;
        cy = tev.clientY;
      }

      document.dispatchEvent(new CustomEvent('dragdrop-drop', { detail: { x: cx, y: cy + yOffset } }));

      state.dragDropPreview = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
  }

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      this.isPanning = true;
      this.lastPanX = (t1.clientX + t2.clientX) / 2;
      this.lastPanY = (t1.clientY + t2.clientY) / 2;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (this.mode === 'pan') {
        this.isPanning = true;
        this.lastPanX = t.clientX;
        this.lastPanY = t.clientY;
      } else if (state.currentTool === 'dragdrop') {
        this._onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY, touches: e.touches, type: 'touchstart' });
      } else {
        this._onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY });
      }
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const mx = (t1.clientX + t2.clientX) / 2;
      const my = (t1.clientY + t2.clientY) / 2;

      if (this.lastTouchDist > 0) {
        this._zoomAt(dist / this.lastTouchDist, { x: mx, y: my });
      }
      this.offsetX += mx - this.lastPanX;
      this.offsetY += my - this.lastPanY;
      this.lastPanX = mx;
      this.lastPanY = my;
      this.lastTouchDist = dist;
      this._storeWorkspaceView();
      this._render();
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (this.isPanning) {
        this.offsetX += t.clientX - this.lastPanX;
        this.offsetY += t.clientY - this.lastPanY;
        this.lastPanX = t.clientX;
        this.lastPanY = t.clientY;
        this._storeWorkspaceView();
        this._render();
      } else {
        this._onMouseMove({ clientX: t.clientX, clientY: t.clientY });
      }
    }
  }

  _onTouchEnd(e) {
    if (e.touches.length < 2) this.lastTouchDist = 0;
    if (e.touches.length === 0) {
      this.isPanning = false;
      this.isDragging = false;
      this.isMovingSelection = false;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this._zoomAt(e.deltaY > 0 ? 0.85 : 1.18, { x: e.clientX, y: e.clientY });
    this._render();
  }

  _zoomAt(factor, screenPos) {
    const rect = this.canvasWrap.getBoundingClientRect();
    const cx = screenPos ? screenPos.x - rect.left : rect.width / 2;
    const cy = screenPos ? screenPos.y - rect.top : rect.height / 2;
    const oldZoom = this.zoom;
    this.zoom = Math.min(10, Math.max(0.1, this.zoom * factor));
    this.offsetX = cx - (cx - this.offsetX) * (this.zoom / oldZoom);
    this.offsetY = cy - (cy - this.offsetY) * (this.zoom / oldZoom);
    this._storeWorkspaceView();
    this._render();
  }

  _deleteHoveredTileset() {
    const workspaceTilesets = this._getWorkspaceTilesets();
    if (!this.hoveredTilesetId && workspaceTilesets.length > 0) {
      this.hoveredTilesetId = workspaceTilesets[workspaceTilesets.length - 1].id;
    }
    if (!this.hoveredTilesetId) return;
    const tileset = getTileset(this.hoveredTilesetId);
    const name = tileset?.name || 'this tileset';
    if (!confirm(`Delete "${name}"?\n\nAny tiles placed from this tileset on the canvas will also be removed.`)) return;
    this._removeTileset(this.hoveredTilesetId);
  }

  _removeTileset(id, options = {}) {
    const { skipRefresh = false, skipWorkspaceUpdate = false } = options;
    const nextLayers = state.layers.map(layer => {
      const nextData = {};
      for (const [key, tile] of Object.entries(layer.data || {})) {
        if (tile?.tilesetId !== id) {
          nextData[key] = tile;
        }
      }
      return { ...layer, data: nextData };
    });

    state.tilesets = state.tilesets.filter(tileset => tileset.id !== id);
    if (!skipWorkspaceUpdate) {
      state.tilesetWorkspaces = state.tilesetWorkspaces.map(workspace => ({
        ...workspace,
        tilesetIds: workspace.tilesetIds.filter(tilesetId => tilesetId !== id)
      }));
    }
    state.layers = nextLayers;

    if (state.activeTilesetId === id) {
      state.activeTilesetId = this._getWorkspaceTilesets()[0]?.id || null;
    }
    if (state.selectedTiles?.tilesetId === id) {
      state.selectedTiles = null;
    }

    this.hoveredTilesetId = null;
    if (!skipRefresh) {
      this.refreshUI({ preserveView: true });
    }
  }

  _showContextMenu(mx, my) {
    document.querySelectorAll('.context-menu').forEach(menu => menu.remove());

    const { wx, wy } = this._screenToWorld(mx, my);
    const targetId = this._hitTestTileset(wx, wy);
    if (!targetId) return;

    const tileset = getTileset(targetId);
    if (!tileset) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${mx}px`;
    menu.style.top = `${my}px`;

    const label = document.createElement('div');
    label.style.cssText = 'padding:4px 12px;font-size:11px;color:#999;border-bottom:1px solid #444;';
    label.textContent = tileset.name;
    menu.appendChild(label);

    const delBtn = document.createElement('button');
    delBtn.className = 'context-menu__item danger';
    delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Remove';
    delBtn.addEventListener('click', () => {
      menu.remove();
      if (confirm(`Delete "${tileset.name}"?\n\nAny tiles placed from this tileset on the canvas will also be removed.`)) {
        this._removeTileset(targetId);
      }
    });
    menu.appendChild(delBtn);

    document.body.appendChild(menu);
    const close = ev => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 10);
  }

  _clearCanvases() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.selCtx.clearRect(0, 0, this.selCanvas.width, this.selCanvas.height);
  }

  _render() {
    const workspaceTilesets = this._getWorkspaceTilesets();
    if (workspaceTilesets.length === 0) {
      this._clearCanvases();
      return;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;

    const ctx = this.ctx;
    const selCtx = this.selCtx;
    const ts = state.tileSize;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.zoom, this.zoom);

    const invZoom = 1 / this.zoom;
    const visX0 = -this.offsetX * invZoom;
    const visY0 = -this.offsetY * invZoom;
    const visX1 = visX0 + w * invZoom;
    const visY1 = visY0 + h * invZoom;
    const gridStartX = Math.floor(visX0 / ts) * ts;
    const gridStartY = Math.floor(visY0 / ts) * ts;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5 / this.zoom;

    for (let x = gridStartX; x <= visX1; x += ts) {
      ctx.beginPath();
      ctx.moveTo(x, visY0);
      ctx.lineTo(x, visY1);
      ctx.stroke();
    }
    for (let y = gridStartY; y <= visY1; y += ts) {
      ctx.beginPath();
      ctx.moveTo(visX0, y);
      ctx.lineTo(visX1, y);
      ctx.stroke();
    }

    ctx.imageSmoothingEnabled = false;
    for (const tileset of workspaceTilesets) {
      const pos = this.tilesetPositions.get(tileset.id);
      if (!pos) continue;

      const gridW = tileset.cols * ts;
      const gridH = tileset.rows * ts;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(pos.x, pos.y, gridW, gridH);
      ctx.drawImage(tileset.image, 0, 0, tileset.width, tileset.height, pos.x, pos.y, gridW, gridH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeRect(pos.x, pos.y, gridW, gridH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.3 / this.zoom;
      for (let c = 1; c < tileset.cols; c++) {
        ctx.beginPath();
        ctx.moveTo(pos.x + c * ts, pos.y);
        ctx.lineTo(pos.x + c * ts, pos.y + gridH);
        ctx.stroke();
      }
      for (let r = 1; r < tileset.rows; r++) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y + r * ts);
        ctx.lineTo(pos.x + gridW, pos.y + r * ts);
        ctx.stroke();
      }

      const labelSize = Math.max(8, 10 / this.zoom);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${labelSize}px sans-serif`;
      ctx.fillText(tileset.name, pos.x + 2 / this.zoom, pos.y - 3 / this.zoom);
    }

    ctx.restore();

    selCtx.clearRect(0, 0, w, h);
    const sel = state.selectedTiles;
    if (!sel || !this._workspaceContainsTileset(sel.tilesetId)) return;

    const tileset = getTileset(sel.tilesetId);
    const pos = tileset ? this.tilesetPositions.get(sel.tilesetId) : null;
    if (!tileset || !pos) return;

    const minC = Math.min(sel.startCol, sel.endCol);
    const maxC = Math.max(sel.startCol, sel.endCol);
    const minR = Math.min(sel.startRow, sel.endRow);
    const maxR = Math.max(sel.startRow, sel.endRow);

    const sx = (pos.x + minC * ts) * this.zoom + this.offsetX;
    const sy = (pos.y + minR * ts) * this.zoom + this.offsetY;
    const sw = (maxC - minC + 1) * ts * this.zoom;
    const sh = (maxR - minR + 1) * ts * this.zoom;

    selCtx.fillStyle = 'rgba(68, 160, 255, 0.25)';
    selCtx.fillRect(sx, sy, sw, sh);
    selCtx.strokeStyle = '#44a0ff';
    selCtx.lineWidth = 2;
    selCtx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
  }
}
