import AsyncStorage from '@react-native-async-storage/async-storage';
import { planPaddleWithWeather } from './claudeService';
import { validateMaritimeRoute, getRouteLaunchPoint } from './routeService';

const STORAGE_KEY = 'SOLVAA_ACTIVE_SEARCHES';
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

let searches = [];
let abortControllers = new Map();
let subscribers = new Set();

function generateId() {
  return `search_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function notify() {
  const snapshot = [...searches];
  subscribers.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (_) {}
  });
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch (_) {}
}

async function load() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      searches = JSON.parse(raw);
    }
  } catch (_) {
    searches = [];
  }
}

function updateEntry(id, updates) {
  const idx = searches.findIndex((s) => s.id === id);
  if (idx === -1) return;
  searches[idx] = { ...searches[idx], ...updates };
}

async function executeSearch(id, params) {
  const controller = new AbortController();
  abortControllers.set(id, controller);

  try {
    const { destination, ...planParams } = params;
    const plan = await planPaddleWithWeather(planParams);

    // Validate each route's waypoints (same pattern as PlannerScreen handleGenerate)
    if (plan && plan.routes) {
      for (const route of plan.routes) {
        if (route.waypoints && route.waypoints.length > 0) {
          const launchPoint = getRouteLaunchPoint(route);
          const validation = validateMaritimeRoute(route.waypoints, launchPoint);
          route.validation = validation;
        }
      }
    }

    if (controller.signal.aborted) return;

    updateEntry(id, {
      status: 'complete',
      completedAt: new Date().toISOString(),
      plan,
      error: null,
    });
  } catch (err) {
    if (controller.signal.aborted) return;

    updateEntry(id, {
      status: 'error',
      completedAt: new Date().toISOString(),
      error: err.message || 'Search failed',
    });
  } finally {
    abortControllers.delete(id);
    await persist();
    notify();
  }
}

export function startSearch(params) {
  const id = generateId();
  const entry = {
    id,
    status: 'pending',
    params,
    startedAt: new Date().toISOString(),
    completedAt: null,
    plan: null,
    error: null,
  };

  searches.unshift(entry);
  persist().then(() => notify());

  executeSearch(id, params);

  return id;
}

export async function cancelSearch(id) {
  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }

  searches = searches.filter((s) => s.id !== id);
  await persist();
  notify();
}

export async function getSearches() {
  await load();
  return [...searches].sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  );
}

export async function getSearch(id) {
  await load();
  return searches.find((s) => s.id === id) || null;
}

export async function deleteSearch(id) {
  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }

  searches = searches.filter((s) => s.id !== id);
  await persist();
  notify();
}

export async function resumeStaleSearches() {
  await load();
  const now = Date.now();
  let changed = false;

  for (const entry of searches) {
    if (entry.status === 'pending') {
      const age = now - new Date(entry.startedAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        entry.status = 'stale';
        entry.completedAt = new Date().toISOString();
        changed = true;
      }
    }
  }

  if (changed) {
    await persist();
    notify();
  }
}

export function retrySearch(id) {
  const entry = searches.find((s) => s.id === id);
  if (!entry || (entry.status !== 'stale' && entry.status !== 'error')) {
    return null;
  }

  updateEntry(id, {
    status: 'pending',
    startedAt: new Date().toISOString(),
    completedAt: null,
    plan: null,
    error: null,
  });

  persist().then(() => notify());

  executeSearch(id, entry.params);

  return id;
}

export function subscribe(callback) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
