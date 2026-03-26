/**
 * state.js — Central reactive state store
 */

const listeners = new Map();

const initialState = {
  // Project
  projectName: 'Untitled Project',
  projectDescription: '',
  tileSize: 16,
  mapWidth: 40,
  mapHeight: 30,
  gridVisible: true,
  gridColor: '#000000',

  // Tools
  currentTool: 'pencil',
  flipH: false,
  flipV: false,

  // Canvas
  canvasOffsetX: 0,
  canvasOffsetY: 0,
  zoom: 2,  // Start at 2x zoom so tiles are visible
  // Drag & drop cross-canvas state
  dragDropPreview: null, // { active: bool, screenX: number, screenY: number, col, row, cols, rows, tilesetId }
  isPanning: false,

  // Tileset
  tilesets: [],
  tilesetWorkspaces: [
    {
      id: 'tsw_1',
      name: 'Canvas 1',
      tilesetIds: []
    }
  ],
  activeTilesetWorkspaceId: 'tsw_1',
  activeTilesetId: null,
  selectedTiles: null,

  // Layers
  layers: [],
  activeLayerId: null,

  // History
  undoStack: [],
  redoStack: [],
};

function cloneState(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cloneState);
  const clone = {};
  for (const key in obj) clone[key] = cloneState(obj[key]);
  return clone;
}

const stateData = cloneState(initialState);

const state = new Proxy(stateData, {
  set(target, prop, value) {
    const oldValue = target[prop];
    target[prop] = value;
    if (oldValue !== value) {
      emit(prop, value, oldValue);
    }
    return true;
  }
});

function on(prop, callback) {
  if (!listeners.has(prop)) listeners.set(prop, new Set());
  listeners.get(prop).add(callback);
  return () => listeners.get(prop).delete(callback);
}

function emit(prop, newValue, oldValue) {
  const cbs = listeners.get(prop);
  if (cbs) cbs.forEach(cb => cb(newValue, oldValue));
  const wcbs = listeners.get('*');
  if (wcbs) wcbs.forEach(cb => cb(prop, newValue, oldValue));
}

function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId) || null;
}

function getTileset(id) {
  return state.tilesets.find(t => t.id === id) || null;
}

function getTilesetWorkspace(id) {
  return state.tilesetWorkspaces.find(w => w.id === id) || null;
}

function getActiveTilesetWorkspace() {
  return getTilesetWorkspace(state.activeTilesetWorkspaceId) || state.tilesetWorkspaces[0] || null;
}

function resetState() {
  const fresh = cloneState(initialState);
  for (const key of Object.keys(fresh)) {
    state[key] = fresh[key];
  }
}

export { state, on, getActiveLayer, getTileset, getTilesetWorkspace, getActiveTilesetWorkspace, resetState };
