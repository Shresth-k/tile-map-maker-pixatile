/**
 * LayerPanel.js — Layer management UI
 * Clean redesign: eye + name only in rows, all actions in the drawer header toolbar.
 */

import { state, on } from '../state.js';

let nextLayerId = 1;

export class LayerPanel {
  constructor() {
    this.listEl = document.getElementById('layers-list');
    this.addBtn = document.getElementById('add-layer-btn');

    // Header action buttons (wired in the drawer header)
    this.delLayerBtn   = document.getElementById('layer-action-delete');
    this.upLayerBtn    = document.getElementById('layer-action-up');
    this.downLayerBtn  = document.getElementById('layer-action-down');
    this.dupLayerBtn   = document.getElementById('layer-action-duplicate');

    // Both add buttons (header + footer)
    const addHeaderBtn = document.getElementById('layer-action-add');
    if (this.addBtn) this.addBtn.addEventListener('click', () => this.addLayer());
    if (addHeaderBtn) addHeaderBtn.addEventListener('click', () => this.addLayer());
    if (this.delLayerBtn)  this.delLayerBtn.addEventListener('click',  () => this.removeActiveLayer());
    if (this.upLayerBtn)   this.upLayerBtn.addEventListener('click',   () => this.moveActiveLayer(1));
    if (this.downLayerBtn) this.downLayerBtn.addEventListener('click', () => this.moveActiveLayer(-1));
    if (this.dupLayerBtn)  this.dupLayerBtn.addEventListener('click',  () => this.duplicateActiveLayer());

    on('layers', () => this.renderLayers());
    on('activeLayerId', () => this.renderLayers());

    // Initialize with one layer
    this.addLayer('Ground');
  }

  addLayer(name) {
    const id = 'layer_' + nextLayerId++;
    const layerName = name || `Layer ${state.layers.length + 1}`;
    const layer = { id, name: layerName, visible: true, data: {} };
    state.layers = [...state.layers, layer];
    state.activeLayerId = id;
  }

  removeActiveLayer() {
    const id = state.activeLayerId;
    if (!id || state.layers.length <= 1) return;
    state.layers = state.layers.filter(l => l.id !== id);
    state.activeLayerId = state.layers[state.layers.length - 1]?.id || null;
  }

  removeLayer(id) {
    if (state.layers.length <= 1) return;
    state.layers = state.layers.filter(l => l.id !== id);
    if (state.activeLayerId === id) {
      state.activeLayerId = state.layers[state.layers.length - 1]?.id || null;
    }
  }

  duplicateActiveLayer() {
    const id = state.activeLayerId;
    const source = state.layers.find(l => l.id === id);
    if (!source) return;
    const newId = 'layer_' + nextLayerId++;
    const copy = { id: newId, name: source.name + ' Copy', visible: true, data: { ...source.data } };
    const idx = state.layers.findIndex(l => l.id === id);
    const newLayers = [...state.layers];
    newLayers.splice(idx + 1, 0, copy);
    state.layers = newLayers;
    state.activeLayerId = newId;
  }

  moveActiveLayer(direction) {
    const id = state.activeLayerId;
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= state.layers.length) return;
    const newLayers = [...state.layers];
    [newLayers[idx], newLayers[newIdx]] = [newLayers[newIdx], newLayers[idx]];
    state.layers = newLayers;
  }

  renameLayer(id, newName) {
    const layer = state.layers.find(l => l.id === id);
    if (layer) { layer.name = newName || layer.name; state.layers = [...state.layers]; }
  }

  toggleVisibility(id) {
    const layer = state.layers.find(l => l.id === id);
    if (layer) { layer.visible = !layer.visible; state.layers = [...state.layers]; }
  }

  renderLayers() {
    this.listEl.innerHTML = '';

    // Render bottom to top (last in array = top visually)
    const layers = [...state.layers].reverse();

    for (const layer of layers) {
      const li = document.createElement('li');
      li.className = 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '');

      // Clicking anywhere on the row (except visibility btn/name input) selects the layer
      li.addEventListener('click', (e) => {
        if (e.target.closest('.layer-item__visibility') || e.target.closest('.layer-item__name')) return;
        state.activeLayerId = layer.id;
      });
      li.addEventListener('touchstart', (e) => {
        if (e.target.closest('.layer-item__visibility') || e.target.closest('.layer-item__name')) return;
        e.stopPropagation();
      }, { passive: true });

      // Visibility toggle button
      const visBtn = document.createElement('button');
      visBtn.className = 'layer-item__visibility' + (layer.visible ? ' visible' : '');
      visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
      visBtn.innerHTML = layer.visible
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      visBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleVisibility(layer.id); });
      visBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });

      // Name (editable inline)
      const nameInput = document.createElement('input');
      nameInput.className = 'layer-item__name';
      nameInput.type = 'text';
      nameInput.value = layer.name;
      nameInput.addEventListener('click', (e) => { e.stopPropagation(); state.activeLayerId = layer.id; });
      nameInput.addEventListener('change', () => this.renameLayer(layer.id, nameInput.value));
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

      li.append(visBtn, nameInput);
      this.listEl.appendChild(li);
    }

    // Update header action buttons enabled/disabled state
    const hasActive = !!state.activeLayerId;
    const activeIdx = state.layers.findIndex(l => l.id === state.activeLayerId);
    const canMoveUp = activeIdx < state.layers.length - 1;
    const canMoveDown = activeIdx > 0;
    const canDelete = state.layers.length > 1;

    if (this.delLayerBtn)  this.delLayerBtn.disabled = !hasActive || !canDelete;
    if (this.upLayerBtn)   this.upLayerBtn.disabled  = !hasActive || !canMoveUp;
    if (this.downLayerBtn) this.downLayerBtn.disabled = !hasActive || !canMoveDown;
    if (this.dupLayerBtn)  this.dupLayerBtn.disabled  = !hasActive;
  }
}
