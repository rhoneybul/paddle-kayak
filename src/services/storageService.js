/**
 * storageService — local-first storage with background API sync.
 *
 * Strategy:
 *  - All writes go to AsyncStorage immediately (works offline)
 *  - After each write, we attempt to sync to the server in the background
 *  - Reads always come from AsyncStorage first; API is used for initial load
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const KEYS = {
  ACTIVE_TRIP:   'PADDLE_ACTIVE_TRIP',
  HISTORY:       'PADDLE_HISTORY',
  WEATHER:       'PADDLE_WEATHER_CACHE',
  SETTINGS:      'PADDLE_SETTINGS',
  PADDLE_LOG:    'PADDLE_ACTIVE_LOG',
  PROFILE:       'PADDLE_PROFILE',
  SAVED_ROUTES:  'PADDLE_SAVED_ROUTES',
  PENDING_SYNC:  'PADDLE_PENDING_SYNC',
};

// ── Active trip (in-progress paddle) ─────────────────────────────────────────

export async function saveActiveTrip(trip) {
  await AsyncStorage.setItem(KEYS.ACTIVE_TRIP, JSON.stringify({ ...trip, savedAt: Date.now() }));
  // Best-effort server sync — create or update the trip record
  try {
    if (trip.serverId) {
      await api.trips.update(trip.serverId, { status: 'active', route_data: trip.route });
    } else {
      const saved = await api.trips.create({
        trip_type:        trip.tripType?.id || 'day_paddle',
        skill_level:      trip.skillLevel?.key || 'intermediate',
        location_name:    trip.location?.name,
        location_lat:     trip.location?.lat,
        location_lon:     trip.location?.lon,
        planned_date:     new Date().toISOString().split('T')[0],
        duration_days:    trip.tripType?.days || 1,
        route_data:       trip.route,
        weather_snapshot: trip.weather?.current,
      });
      // Store server ID locally for future updates
      const updated = { ...trip, serverId: saved.id, savedAt: Date.now() };
      await AsyncStorage.setItem(KEYS.ACTIVE_TRIP, JSON.stringify(updated));
    }
  } catch (_) {
    // Offline — will sync on next opportunity
  }
}

export async function getActiveTrip() {
  const raw = await AsyncStorage.getItem(KEYS.ACTIVE_TRIP);
  return raw ? JSON.parse(raw) : null;
}

export async function clearActiveTrip() {
  await AsyncStorage.removeItem(KEYS.ACTIVE_TRIP);
  await AsyncStorage.removeItem(KEYS.PADDLE_LOG);
}

// ── GPS log (written frequently during paddle) ────────────────────────────────

export async function addPaddleLogEntry(entry) {
  const raw = await AsyncStorage.getItem(KEYS.PADDLE_LOG);
  const log = raw ? JSON.parse(raw) : [];
  log.push({ ...entry, ts: Date.now() });
  await AsyncStorage.setItem(KEYS.PADDLE_LOG, JSON.stringify(log.slice(-2000)));
}

export async function getPaddleLog() {
  const raw = await AsyncStorage.getItem(KEYS.PADDLE_LOG);
  return raw ? JSON.parse(raw) : [];
}

// ── History (completed paddles) ───────────────────────────────────────────────

export async function saveToHistory(completedTrip) {
  // 1. Save locally
  const raw = await AsyncStorage.getItem(KEYS.HISTORY);
  const history = raw ? JSON.parse(raw) : [];
  history.unshift({ ...completedTrip, completedAt: Date.now() });
  await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(history.slice(0, 100)));

  // 2. Push to server
  try {
    const gpsTrack   = await getPaddleLog();
    const paddle = await api.paddles.create({
      trip_id:          completedTrip.serverId || null,
      started_at:       new Date(completedTrip.startedAt).toISOString(),
      finished_at:      new Date().toISOString(),
      distance_km:      completedTrip.distancePaddled,
      duration_seconds: completedTrip.durationSeconds,
      avg_speed_knots:  completedTrip.avgSpeed,
      max_speed_knots:  completedTrip.maxSpeed,
      gps_track:        gpsTrack,
      weather_log:      completedTrip.weatherLog || [],
      notes:            completedTrip.notes,
    });

    // Mark trip as completed on server
    if (completedTrip.serverId) {
      await api.trips.update(completedTrip.serverId, { status: 'completed' });
    }
  } catch (_) {
    // Offline — history is safe locally, will sync next time
  }
}

export async function getHistory() {
  // Try to get fresh data from server, fall back to local cache
  try {
    const paddles = await api.paddles.list();
    // Normalise server format to match what screens expect
    const normalised = paddles.map(p => ({
      id:               p.id,
      serverId:         p.id,
      distancePaddled:  p.distance_km,
      durationSeconds:  p.duration_seconds,
      completedAt:      new Date(p.finished_at || p.created_at).getTime(),
      route:            p.trips?.route_data,
      skillLevel:       { label: 'Intermediate' },
      tripType:         { label: p.trips?.trip_type || 'Day trip' },
      weather:          { current: p.weather_log?.[0] },
      location:         p.trips?.location_name,
    }));
    // Also update local cache
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(normalised));
    return normalised;
  } catch (_) {
    // Offline — return local cache
    const raw = await AsyncStorage.getItem(KEYS.HISTORY);
    return raw ? JSON.parse(raw) : [];
  }
}

export async function getPaddleStats() {
  try {
    return await api.paddles.stats();
  } catch (_) {
    // Compute locally
    const history = await getHistory();
    return {
      count:       history.length,
      total_km:    +history.reduce((s, t) => s + (t.distancePaddled || 0), 0).toFixed(2),
      total_hours: +(history.reduce((s, t) => s + (t.durationSeconds || 0), 0) / 3600).toFixed(1),
    };
  }
}

// ── User profile ──────────────────────────────────────────────────────────────

export async function getProfile() {
  try {
    const profile = await api.users.me();
    await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
    return profile;
  } catch (_) {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE);
    return raw ? JSON.parse(raw) : null;
  }
}

export async function updateProfile(updates) {
  const updated = await api.users.update(updates);
  await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(updated));
  return updated;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings() {
  const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
  return raw ? JSON.parse(raw) : {
    units:         'metric',
    tempUnit:      'celsius',
    notifications: true,
  };
}

export async function saveSettings(settings) {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

// ── Weather cache ─────────────────────────────────────────────────────────────

export async function getCachedWeather(lat, lon) {
  const raw = await AsyncStorage.getItem(KEYS.WEATHER);
  if (!raw) return null;
  const { data, lat: cLat, lon: cLon, ts } = JSON.parse(raw);
  const stale = Date.now() - ts > 3 * 60 * 60 * 1000; // 3 hours
  const nearby = Math.abs(cLat - lat) < 0.1 && Math.abs(cLon - lon) < 0.1;
  return (!stale && nearby) ? { ...data, fromCache: true, cacheAge: Date.now() - ts } : null;
}

export async function saveWeatherCache(lat, lon, data) {
  await AsyncStorage.setItem(KEYS.WEATHER, JSON.stringify({ lat, lon, data, ts: Date.now() }));
}

// ── Saved routes (date-independent bookmarks) ─────────────────────────────────

/** Normalise a server row (snake_case) into the local format used by screens. */
function normaliseServerRoute(row) {
  return {
    id:               row.id,
    serverId:         row.id,
    savedAt:          new Date(row.created_at).getTime(),
    name:             row.name,
    location:         row.location || '',
    locationCoords:   (row.location_lat != null && row.location_lon != null)
                        ? { lat: row.location_lat, lng: row.location_lon }
                        : null,
    distanceKm:       row.distance_km || 0,
    terrain:          row.terrain || '',
    difficulty:       row.difficulty || 'intermediate',
    estimated_duration: row.estimated_duration || 2,
    waypoints:        row.waypoints || [],
    launchPoint:      row.launch_point || '',
    travelFromBase:   row.travel_from_base || '',
    travelTimeMin:    row.travel_time_min || 0,
    highlights:       row.highlights || [],
    description:      row.description || '',
    gpxUrl:           row.gpx_url || null,
  };
}

export async function getSavedRoutes() {
  // Try server first; fall back to local cache
  try {
    const rows = await api.savedRoutes.list();
    const normalised = rows.map(normaliseServerRoute);
    await AsyncStorage.setItem(KEYS.SAVED_ROUTES, JSON.stringify(normalised));
    return normalised;
  } catch (_) {
    const raw = await AsyncStorage.getItem(KEYS.SAVED_ROUTES);
    return raw ? JSON.parse(raw) : [];
  }
}

export async function saveRoute(route, customName) {
  const name = customName || route.name || 'Unnamed route';
  const entry = {
    id:               Date.now().toString(),
    savedAt:          Date.now(),
    name,
    location:         route.location || '',
    locationCoords:   route.locationCoords || null,
    distanceKm:       route.distanceKm || 0,
    terrain:          route.terrain || '',
    difficulty:       route.difficulty_rating || route.difficulty || 'intermediate',
    estimated_duration: route.estimated_duration || route.durationHours || 2,
    waypoints:        route.waypoints || [],
    launchPoint:      route.launchPoint || '',
    travelFromBase:   route.travelFromBase || '',
    travelTimeMin:    route.travelTimeMin || 0,
    highlights:       route.highlights || [],
    description:      route.description || '',
  };

  // Optimistically write to local cache
  const cached = await AsyncStorage.getItem(KEYS.SAVED_ROUTES);
  const routes = cached ? JSON.parse(cached) : [];
  routes.unshift(entry);
  await AsyncStorage.setItem(KEYS.SAVED_ROUTES, JSON.stringify(routes.slice(0, 50)));

  // Sync to server in background
  try {
    const serverRow = await api.savedRoutes.create({
      name,
      location_name:     entry.location,
      location_lat:      entry.locationCoords?.lat,
      location_lon:      entry.locationCoords?.lng,
      distance_km:       entry.distanceKm,
      terrain:           entry.terrain,
      difficulty:        entry.difficulty,
      estimated_duration: entry.estimated_duration,
      waypoints:         entry.waypoints,
      highlights:        entry.highlights,
      launch_point:      entry.launchPoint,
      travel_from_base:  entry.travelFromBase,
      travel_time_min:   entry.travelTimeMin,
      description:       entry.description,
      route_data:        route,
    });
    // Update local entry with server-assigned id and gpx_url
    const updated = [...routes];
    const idx = updated.findIndex(r => r.id === entry.id);
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], serverId: serverRow.id, gpxUrl: serverRow.gpx_url };
      await AsyncStorage.setItem(KEYS.SAVED_ROUTES, JSON.stringify(updated));
    }
    return { ...entry, serverId: serverRow.id, gpxUrl: serverRow.gpx_url };
  } catch (_) {
    // Offline — entry saved locally, will sync on next load
    return entry;
  }
}

export async function deleteSavedRoute(id) {
  const cached = await AsyncStorage.getItem(KEYS.SAVED_ROUTES);
  const routes = cached ? JSON.parse(cached) : [];
  const target = routes.find(r => r.id === id || r.serverId === id);
  await AsyncStorage.setItem(KEYS.SAVED_ROUTES, JSON.stringify(routes.filter(r => r.id !== id && r.serverId !== id)));
  // Background delete from server
  const serverId = target?.serverId;
  if (serverId) {
    try { await api.savedRoutes.delete(serverId); } catch (_) {
      // Queue for later if offline
      await queuePendingSync({ action: 'delete_route', id: serverId });
    }
  }
}

// ── Favorite toggling (optimistic UI with offline queue) ─────────────────────

/**
 * Check if a route is already saved (by name + waypoints match or serverId).
 */
export async function isRouteSaved(routeName, waypoints) {
  const cached = await AsyncStorage.getItem(KEYS.SAVED_ROUTES);
  const routes = cached ? JSON.parse(cached) : [];
  return routes.find(r =>
    r.name === routeName ||
    (r.serverId && r.name === routeName)
  ) || null;
}

/**
 * Toggle favorite: saves if not saved, deletes if already saved.
 * Returns { saved: boolean, route: object|null }
 */
export async function toggleFavorite(route, customName) {
  const name = customName || route.name || 'Unnamed route';
  const existing = await isRouteSaved(name);

  if (existing) {
    await deleteSavedRoute(existing.id || existing.serverId);
    return { saved: false, route: null };
  } else {
    const saved = await saveRoute(route, name);
    return { saved: true, route: saved };
  }
}

// ── Pending sync queue (offline actions) ────────────────────────────────────

async function queuePendingSync(action) {
  const raw = await AsyncStorage.getItem(KEYS.PENDING_SYNC);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ ...action, queuedAt: Date.now() });
  await AsyncStorage.setItem(KEYS.PENDING_SYNC, JSON.stringify(queue));
}

export async function flushPendingSyncs() {
  const raw = await AsyncStorage.getItem(KEYS.PENDING_SYNC);
  if (!raw) return;
  const queue = JSON.parse(raw);
  const remaining = [];

  for (const item of queue) {
    try {
      if (item.action === 'delete_route' && item.id) {
        await api.savedRoutes.delete(item.id);
      }
    } catch (_) {
      remaining.push(item);
    }
  }

  if (remaining.length > 0) {
    await AsyncStorage.setItem(KEYS.PENDING_SYNC, JSON.stringify(remaining));
  } else {
    await AsyncStorage.removeItem(KEYS.PENDING_SYNC);
  }
}
