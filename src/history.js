/**
 * history.js — Undo/Redo manager
 * Records tile placement diffs for efficient history.
 */

import { state } from './state.js';

const MAX_HISTORY = 100;

/**
 * Record a set of tile changes as a single action.
 * @param {Array<{layerId, x, y, oldTile, newTile}>} changes
 */
export function recordAction(changes) {
  if (!changes || changes.length === 0) return;
  state.undoStack = [...state.undoStack.slice(-MAX_HISTORY + 1), changes];
  state.redoStack = [];
}

/**
 * Undo the last action
 */
export function undo() {
  const stack = [...state.undoStack];
  if (stack.length === 0) return;
  const action = stack.pop();
  state.undoStack = stack;

  // Apply inverse
  const inverse = [];
  for (const change of action) {
    const layer = state.layers.find(l => l.id === change.layerId);
    if (!layer) continue;
    const key = `${change.x},${change.y}`;
    const currentTile = layer.data[key] || null;
    inverse.push({ ...change, oldTile: currentTile, newTile: change.oldTile });
    if (change.oldTile) {
      layer.data[key] = change.oldTile;
    } else {
      delete layer.data[key];
    }
  }

  state.redoStack = [...state.redoStack, inverse];
  // Trigger re-render by touching layers
  state.layers = [...state.layers];
}

/**
 * Redo the last undone action
 */
export function redo() {
  const stack = [...state.redoStack];
  if (stack.length === 0) return;
  const action = stack.pop();
  state.redoStack = stack;

  const inverse = [];
  for (const change of action) {
    const layer = state.layers.find(l => l.id === change.layerId);
    if (!layer) continue;
    const key = `${change.x},${change.y}`;
    const currentTile = layer.data[key] || null;
    inverse.push({ ...change, oldTile: currentTile, newTile: change.newTile });
    if (change.newTile) {
      layer.data[key] = change.newTile;
    } else {
      delete layer.data[key];
    }
  }

  state.undoStack = [...state.undoStack, inverse];
  state.layers = [...state.layers];
}
