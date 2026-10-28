'use client';

import { create } from 'zustand';
import type { DashboardConfig, Layouts, WidgetLayout } from '../components/default-layouts';
import { getDefaultConfig, DASHBOARD_CONFIG_VERSION } from '../components/default-layouts';

interface ConfigSnapshot {
  layouts: Layouts;
  hiddenWidgets: string[];
  widgetSettings: Record<string, Record<string, unknown>>;
}

interface DashboardState {
  isEditing: boolean;
  isDirty: boolean;

  layouts: Layouts;
  hiddenWidgets: string[];
  widgetSettings: Record<string, Record<string, unknown>>;

  undoStack: ConfigSnapshot[];
  originalSnapshot: ConfigSnapshot | null;

  startEditing: () => void;
  cancelEditing: () => void;
  finishEditing: () => void;
  setLayouts: (layouts: Layouts) => void;
  hideWidget: (id: string) => void;
  showWidget: (id: string, defaultLayout: WidgetLayout) => void;
  undo: () => void;
  setWidgetSetting: (widgetId: string, key: string, value: unknown) => void;

  loadConfig: (config: DashboardConfig) => void;
  resetToDefault: (role?: string, department?: string) => void;
  getConfig: () => DashboardConfig;
}

function takeSnapshot(state: DashboardState): ConfigSnapshot {
  return {
    layouts: structuredClone(state.layouts),
    hiddenWidgets: [...state.hiddenWidgets],
    widgetSettings: structuredClone(state.widgetSettings),
  };
}

const defaultConfig = getDefaultConfig('DOCTOR');

export const useDashboardStore = create<DashboardState>((set, get) => ({
  isEditing: false,
  isDirty: false,
  layouts: defaultConfig.layouts,
  hiddenWidgets: [],
  widgetSettings: {},
  undoStack: [],
  originalSnapshot: null,

  startEditing: () => {
    const snap = takeSnapshot(get());
    set({ isEditing: true, isDirty: false, originalSnapshot: snap, undoStack: [] });
  },

  cancelEditing: () => {
    const { originalSnapshot } = get();
    if (originalSnapshot) {
      set({
        isEditing: false,
        isDirty: false,
        layouts: originalSnapshot.layouts,
        hiddenWidgets: originalSnapshot.hiddenWidgets,
        widgetSettings: originalSnapshot.widgetSettings,
        originalSnapshot: null,
        undoStack: [],
      });
    } else {
      set({ isEditing: false, isDirty: false });
    }
  },

  finishEditing: () => {
    set({ isEditing: false, isDirty: false, originalSnapshot: null, undoStack: [] });
  },

  setLayouts: (layouts) => {
    const state = get();
    if (state.isEditing) {
      const snap = takeSnapshot(state);
      set({
        layouts,
        isDirty: true,
        undoStack: [...state.undoStack.slice(-19), snap],
      });
    } else {
      set({ layouts });
    }
  },

  hideWidget: (id) => {
    const state = get();
    if (state.hiddenWidgets.includes(id)) return;
    const snap = takeSnapshot(state);
    set({
      hiddenWidgets: [...state.hiddenWidgets, id],
      isDirty: true,
      undoStack: [...state.undoStack.slice(-19), snap],
    });
  },

  showWidget: (id, defaultLayout) => {
    const state = get();
    const snap = takeSnapshot(state);
    const newLayouts = { ...state.layouts };
    if (newLayouts.lg && !newLayouts.lg.find(l => l.i === id)) {
      newLayouts.lg = [...newLayouts.lg, { ...defaultLayout, i: id, y: Infinity }];
    }
    set({
      layouts: newLayouts,
      hiddenWidgets: state.hiddenWidgets.filter(w => w !== id),
      isDirty: true,
      undoStack: [...state.undoStack.slice(-19), snap],
    });
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      layouts: prev.layouts,
      hiddenWidgets: prev.hiddenWidgets,
      widgetSettings: prev.widgetSettings,
      undoStack: undoStack.slice(0, -1),
      isDirty: true,
    });
  },

  setWidgetSetting: (widgetId, key, value) => {
    const state = get();
    const snap = takeSnapshot(state);
    const current = state.widgetSettings[widgetId] ?? {};
    set({
      widgetSettings: { ...state.widgetSettings, [widgetId]: { ...current, [key]: value } },
      isDirty: true,
      undoStack: [...state.undoStack.slice(-19), snap],
    });
  },

  loadConfig: (config) => {
    set({
      layouts: config.layouts,
      hiddenWidgets: config.hiddenWidgets,
      widgetSettings: config.widgetSettings,
      isEditing: false,
      isDirty: false,
      undoStack: [],
      originalSnapshot: null,
    });
  },

  resetToDefault: (role, department) => {
    // 첫 화면과 같은 판정(역할 + 부서) — 부서를 빼면 비병동 간호사가 '기본값으로'에서 병동 배치를 받았다
    const config = getDefaultConfig(role, department);
    get().loadConfig(config);
  },

  getConfig: () => {
    const { layouts, hiddenWidgets, widgetSettings } = get();
    return {
      version: DASHBOARD_CONFIG_VERSION,
      layouts: structuredClone(layouts),
      hiddenWidgets: [...hiddenWidgets],
      widgetSettings: structuredClone(widgetSettings),
    };
  },
}));
