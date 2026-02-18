import { createStore } from 'zustand/vanilla';
import type { VigilStore } from '../types/store.js';
import { createAgentSlice } from './slices/agents.js';
import { createPrSlice } from './slices/prs.js';
import { createUiSlice } from './slices/ui.js';

/**
 * Vanilla Zustand store — accessible from both React/Ink components and
 * non-React agent code.
 *
 * Components:  `useStore(vigilStore, selector)`
 * Agents:      `vigilStore.getState()` / `vigilStore.setState()`
 */
export const vigilStore = createStore<VigilStore>()((...a) => ({
  ...createPrSlice(...a),
  ...createAgentSlice(...a),
  ...createUiSlice(...a),
}));
