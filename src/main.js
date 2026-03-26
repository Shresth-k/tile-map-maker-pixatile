/**
 * main.js — App entry point
 * Wires up all modules, shortcuts, sidebar, modals, project save/load.
 */

import { state, on, resetState } from './state.js';
import { undo, redo } from './history.js';
import { TilemapCanvas } from './canvas/TilemapCanvas.js';
import { TilesetPanel } from './tileset/TilesetPanel.js';
import { LayerPanel } from './layers/LayerPanel.js';
import { exportPNG, exportJSON } from './export/exporters.js';

let tilemapCanvas;
let layerPanel;
let tilesetPanel;

function init() {
  const canvasEl = document.getElementById('tilemap-canvas');
  const containerEl = document.getElementById('canvas-container');

  tilemapCanvas = new TilemapCanvas(canvasEl, containerEl);
  tilesetPanel = new TilesetPanel();
  layerPanel = new LayerPanel();

  requestAnimationFrame(() => tilemapCanvas.centerCanvas());

  // === Tool Selection ===
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });
  document.querySelectorAll('.mobile-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  // === Sidebar Toggle (Left — Tileset panel) ===
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarBackdrop.classList.toggle('visible');
  });
  sidebarBackdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('visible');
  });

  // === Layers Drawer Toggle (Right) ===
  const layersDrawer = document.getElementById('layers-drawer');
  const layersBackdrop = document.getElementById('layers-backdrop');
  const layersToggle = document.getElementById('layers-toggle');
  const layersDrawerClose = document.getElementById('layers-drawer-close');

  const isMobile = () => window.innerWidth <= 768;

  function openLayersDrawer() {
    if (isMobile()) {
      layersDrawer.classList.add('open');
      layersBackdrop.classList.add('visible');
    } else {
      layersDrawer.classList.remove('closed');
    }
    layersToggle.classList.add('active');
  }

  function closeLayersDrawer() {
    if (isMobile()) {
      layersDrawer.classList.remove('open');
      layersBackdrop.classList.remove('visible');
    } else {
      layersDrawer.classList.add('closed');
    }
    layersToggle.classList.remove('active');
  }

  function toggleLayersDrawer() {
    const isOpen = isMobile()
      ? layersDrawer.classList.contains('open')
      : !layersDrawer.classList.contains('closed');
    if (isOpen) closeLayersDrawer(); else openLayersDrawer();
  }

  layersToggle.addEventListener('click', toggleLayersDrawer);
  layersDrawerClose.addEventListener('click', closeLayersDrawer);
  layersBackdrop.addEventListener('click', closeLayersDrawer);

  // Start with drawer open on desktop, closed on mobile
  if (!isMobile()) {
    openLayersDrawer();
  }

  // === Zoom ===
  document.getElementById('zoom-in-btn').addEventListener('click', () => tilemapCanvas.zoomIn());
  document.getElementById('zoom-out-btn').addEventListener('click', () => tilemapCanvas.zoomOut());

  // === Undo / Redo ===
  document.getElementById('undo-btn').addEventListener('click', () => undo());
  document.getElementById('redo-btn').addEventListener('click', () => redo());

  // === Selection Delete Button ===
  const selectionActions = document.getElementById('selection-actions');
  document.getElementById('selection-delete-btn').addEventListener('click', () => {
    tilemapCanvas.deleteSelection();
    selectionActions.style.display = 'none';
  });
  // Show/hide contextual button when selection changes
  document.addEventListener('selectionchange', (e) => {
    selectionActions.style.display = e.detail?.hasSelection ? 'flex' : 'none';
  });

  // === Project Panel (slide-down, SpriteFusion style) ===
  const projectModal = document.getElementById('project-modal');
  document.getElementById('project-name-btn').addEventListener('click', () => openProjectPanel());
  document.getElementById('project-modal-close').addEventListener('click', () => closeProjectPanel());
  projectModal.addEventListener('click', (e) => {
    if (e.target === projectModal) closeProjectPanel();
  });

  // OK button
  document.getElementById('project-modal-apply').addEventListener('click', () => {
    applyProjectSettings();
    closeProjectPanel();
  });

  // New button
  document.getElementById('project-new-btn').addEventListener('click', () => {
    if (confirm('Create a new project? Unsaved changes will be lost.')) {
      localStorage.removeItem('tilemap_studio_project');
      resetState();
      layerPanel.addLayer('Ground');
      document.getElementById('project-name-text').textContent = state.projectName;
      tilesetPanel.refreshUI();

      tilemapCanvas.centerCanvas();
      closeProjectPanel();
    }
  });

  // Save button — saves project as a .json file download
  document.getElementById('project-save-btn').addEventListener('click', () => {
    saveProjectFile();
    closeProjectPanel();
  });

  // Load button — loads project from a .json file
  const loadInput = document.getElementById('project-load-input');
  document.getElementById('project-load-btn').addEventListener('click', () => {
    loadInput.click();
  });
  loadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadProjectFile(file);
    e.target.value = '';
    closeProjectPanel();
  });

  // === Export Modal ===
  const exportModal = document.getElementById('export-modal');
  document.getElementById('export-btn').addEventListener('click', () => {
    exportModal.style.display = 'flex';
  });
  document.getElementById('export-modal-close').addEventListener('click', () => {
    exportModal.style.display = 'none';
  });
  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) exportModal.style.display = 'none';
  });

  document.getElementById('export-png').addEventListener('click', () => {
    exportPNG();
    exportModal.style.display = 'none';
  });
  document.getElementById('export-json').addEventListener('click', () => {
    exportJSON();
    exportModal.style.display = 'none';
  });

  // === Keyboard Shortcuts ===
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const key = e.key.toLowerCase();

    if (key === 'p') selectTool('pencil');
    if (key === 'e') selectTool('eraser');
    if (key === 'b') selectTool('bucket');
    if (key === 's' && !e.ctrlKey) selectTool('selection');
    if (key === 'd' && !e.ctrlKey) selectTool('dragdrop');

    if (key === 'h' && !e.ctrlKey) state.flipH = !state.flipH;
    if (key === 'v' && !e.ctrlKey) state.flipV = !state.flipV;

    if (e.ctrlKey && key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }

    if (key === 'delete' || key === 'backspace') {
      if (tilemapCanvas.hasSelection()) { e.preventDefault(); tilemapCanvas.deleteSelection(); }
    }

    if (key === 'escape') {
      closeProjectPanel();
      exportModal.style.display = 'none';
      tilemapCanvas.clearSelection();
      tilemapCanvas.render();
      sidebar.classList.remove('open');
      sidebarBackdrop.classList.remove('visible');
      closeLayersDrawer();
    }

    if (key === ' ') {
      e.preventDefault();
      tilemapCanvas.setSpaceHeld(true);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') tilemapCanvas.setSpaceHeld(false);
  });

  // === Auto-save to localStorage ===
  // /* Temporarily disabled for development */
  // let saveTimeout;
  // on('*', () => {
  //   clearTimeout(saveTimeout);
  //   saveTimeout = setTimeout(autoSave, 2000);
  // });
  //
  // // Load saved project
  // // loadAutoSave();

  console.log('%c✨ TileMap Studio', 'color: #5a8a5a; font-weight: bold; font-size: 14px;');
}


// === Tool Selection ===

function selectTool(tool) {
  state.currentTool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  document.querySelectorAll('.mobile-tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  tilemapCanvas._updateCursor();
}

// === Project Panel ===

function openProjectPanel() {
  document.getElementById('setting-name').value = state.projectName;
  document.getElementById('setting-description').value = state.projectDescription || '';
  document.getElementById('setting-tile-size').value = state.tileSize;
  document.getElementById('setting-map-width').value = state.mapWidth;
  document.getElementById('setting-map-height').value = state.mapHeight;
  document.getElementById('setting-grid-color').value = state.gridColor;
  document.getElementById('setting-grid-visible').checked = state.gridVisible;
  document.getElementById('project-modal').style.display = 'flex';
}

function closeProjectPanel() {
  document.getElementById('project-modal').style.display = 'none';
}

function applyProjectSettings() {
  state.projectName = document.getElementById('setting-name').value || 'Untitled Project';
  state.projectDescription = document.getElementById('setting-description').value || '';
  state.tileSize = parseInt(document.getElementById('setting-tile-size').value) || 16;
  state.mapWidth = parseInt(document.getElementById('setting-map-width').value) || 40;
  state.mapHeight = parseInt(document.getElementById('setting-map-height').value) || 30;
  state.gridColor = document.getElementById('setting-grid-color').value || '#000000';
  state.gridVisible = document.getElementById('setting-grid-visible').checked;

  document.getElementById('project-name-text').textContent = state.projectName;

  // Recalculate tileset cols/rows
  for (const ts of state.tilesets) {
    ts.cols = Math.floor(ts.width / state.tileSize);
    ts.rows = Math.floor(ts.height / state.tileSize);
  }
  state.tilesets = [...state.tilesets];

  tilemapCanvas.centerCanvas();
}

// === Project File Save / Load ===

function saveProjectFile() {
  const data = buildProjectData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.projectName}.tilemap.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadProjectFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      applyLoadedProject(data);
    } catch (err) {
      alert('Failed to load project: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// === Auto-save ===

function autoSave() {
  try {
    const data = buildProjectData();
    localStorage.setItem('tilemap_studio_project', JSON.stringify(data));
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

function loadAutoSave() {
  try {
    const raw = localStorage.getItem('tilemap_studio_project');
    if (!raw) return;
    const data = JSON.parse(raw);
    applyLoadedProject(data);
  } catch (e) {
    console.warn('Load failed:', e);
  }
}

// === Shared Helpers ===

function buildProjectData() {
  return {
    projectName: state.projectName,
    projectDescription: state.projectDescription,
    tileSize: state.tileSize,
    mapWidth: state.mapWidth,
    mapHeight: state.mapHeight,
    gridVisible: state.gridVisible,
    gridColor: state.gridColor,
    layers: state.layers.map(l => ({
      id: l.id, name: l.name, visible: l.visible, data: l.data
    })),
    activeLayerId: state.activeLayerId,
    tilesets: state.tilesets.map(ts => ({
      id: ts.id, name: ts.name, dataURL: ts.dataURL,
      cols: ts.cols, rows: ts.rows, width: ts.width, height: ts.height
    })),
    tilesetWorkspaces: state.tilesetWorkspaces.map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      tilesetIds: [...workspace.tilesetIds]
    })),
    activeTilesetWorkspaceId: state.activeTilesetWorkspaceId,
    activeTilesetId: state.activeTilesetId,
    selectedTiles: state.selectedTiles
  };
}

function applyLoadedProject(data) {
  state.projectName = data.projectName || 'Untitled Project';
  state.projectDescription = data.projectDescription || '';
  state.tileSize = data.tileSize || 16;
  state.mapWidth = data.mapWidth || 40;
  state.mapHeight = data.mapHeight || 30;
  state.gridVisible = data.gridVisible !== false;
  state.gridColor = data.gridColor || '#000000';

  document.getElementById('project-name-text').textContent = state.projectName;

  const tilesetData = data.tilesets || [];
  const workspaceData = Array.isArray(data.tilesetWorkspaces) ? data.tilesetWorkspaces : null;
  if (tilesetData.length === 0) {
    state.layers = data.layers || [];
    state.activeLayerId = data.activeLayerId || state.layers[0]?.id;
    state.tilesets = [];
    state.tilesetWorkspaces = [{
      id: 'tsw_1',
      name: 'Canvas 1',
      tilesetIds: []
    }];
    state.activeTilesetWorkspaceId = 'tsw_1';
    state.activeTilesetId = null;
    state.selectedTiles = null;
    tilesetPanel.refreshUI();
    return;
  }

  let loaded = 0;
  const results = [];

  for (const tsData of tilesetData) {
    const img = new Image();
    img.onload = () => {
      results.push({ ...tsData, image: img });
      loaded++;
      if (loaded === tilesetData.length) {
        state.tilesets = results;
        state.tilesetWorkspaces = normalizeTilesetWorkspaces(workspaceData, results);
        state.activeTilesetWorkspaceId = resolveActiveWorkspaceId(data.activeTilesetWorkspaceId, state.tilesetWorkspaces);
        state.activeTilesetId = data.activeTilesetId || results[0]?.id;
        state.selectedTiles = data.selectedTiles || null;
        state.layers = data.layers || [];
        state.activeLayerId = data.activeLayerId || state.layers[0]?.id;
        tilesetPanel.refreshUI();

        tilemapCanvas.centerCanvas();
      }
    };
    img.onerror = () => {
      loaded++;
      if (loaded === tilesetData.length) {
        state.layers = data.layers || [];
        state.activeLayerId = data.activeLayerId || state.layers[0]?.id;
        tilesetPanel.refreshUI();
      }
    };
    img.src = tsData.dataURL;
  }
}

function normalizeTilesetWorkspaces(workspaces, tilesets) {
  const defaultWorkspace = {
    id: 'tsw_1',
    name: 'Canvas 1',
    tilesetIds: tilesets.map(ts => ts.id)
  };

  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return [defaultWorkspace];
  }

  const validIds = new Set(tilesets.map(ts => ts.id));
  const normalized = workspaces.map((workspace, index) => ({
    id: workspace.id || `tsw_${index + 1}`,
    name: workspace.name || `Canvas ${index + 1}`,
    tilesetIds: Array.isArray(workspace.tilesetIds)
      ? workspace.tilesetIds.filter(id => validIds.has(id))
      : []
  }));

  const assignedIds = new Set(normalized.flatMap(workspace => workspace.tilesetIds));
  const unassignedIds = tilesets
    .map(ts => ts.id)
    .filter(id => !assignedIds.has(id));

  if (unassignedIds.length > 0) {
    normalized[0].tilesetIds.push(...unassignedIds);
  }

  return normalized;
}

function resolveActiveWorkspaceId(activeWorkspaceId, workspaces) {
  if (workspaces.some(workspace => workspace.id === activeWorkspaceId)) {
    return activeWorkspaceId;
  }
  return workspaces[0]?.id || 'tsw_1';
}

// === Boot ===
document.addEventListener('DOMContentLoaded', init);
