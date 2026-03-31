/**
 * Background location task — keeps GPS tracking alive when the app is backgrounded.
 *
 * Expo's TaskManager runs this callback even when the app is in the background,
 * so the paddle continues to be tracked.
 *
 * Data is stored in AsyncStorage and picked up by ActivePaddleScreen on foreground.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_LOCATION_TASK = 'SOLVAA_BACKGROUND_LOCATION';

const BG_TRACK_KEY  = 'SOLVAA_BG_TRACK';
const BG_STATS_KEY  = 'SOLVAA_BG_STATS';

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

// Define the background task
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[BackgroundLocation] error:', error.message);
    return;
  }
  if (!data?.locations?.length) return;

  try {
    const newLocs = data.locations;

    // Read existing background track
    const rawTrack = await AsyncStorage.getItem(BG_TRACK_KEY);
    const track = rawTrack ? JSON.parse(rawTrack) : [];
    const rawStats = await AsyncStorage.getItem(BG_STATS_KEY);
    const stats = rawStats ? JSON.parse(rawStats) : { distKm: 0, lastUpdate: null };

    for (const loc of newLocs) {
      const pt = { lat: loc.coords.latitude, lon: loc.coords.longitude, ts: loc.timestamp };
      track.push(pt);

      // Update distance
      if (track.length > 1) {
        const prev = track[track.length - 2];
        stats.distKm += haversineKm(
          { latitude: prev.lat, longitude: prev.lon },
          { latitude: pt.lat, longitude: pt.lon },
        );
      }
      stats.lastUpdate = Date.now();
    }

    // Cap track size to prevent storage issues
    const trimmed = track.length > 5000 ? track.slice(-5000) : track;

    await AsyncStorage.setItem(BG_TRACK_KEY, JSON.stringify(trimmed));
    await AsyncStorage.setItem(BG_STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.warn('[BackgroundLocation] storage error:', e?.message);
  }
});

/**
 * Start background location tracking.
 * Call this when the paddle begins.
 */
export async function startBackgroundTracking() {
  // Clear any previous background data
  await AsyncStorage.multiRemove([BG_TRACK_KEY, BG_STATS_KEY]);

  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') return false;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Solvaa — Tracking your paddle',
      notificationBody: 'GPS tracking is active',
      notificationColor: '#4A6CF7',
    },
  });

  return true;
}

/**
 * Stop background location tracking.
 */
export async function stopBackgroundTracking() {
  try {
    const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch { /* ignore */ }
}

/**
 * Read background track data accumulated while the app was backgrounded.
 * Returns { track: [{lat, lon, ts}], distKm: number } and clears the buffer.
 */
export async function consumeBackgroundTrack() {
  try {
    const rawTrack = await AsyncStorage.getItem(BG_TRACK_KEY);
    const rawStats = await AsyncStorage.getItem(BG_STATS_KEY);
    const track = rawTrack ? JSON.parse(rawTrack) : [];
    const stats = rawStats ? JSON.parse(rawStats) : { distKm: 0 };
    // Don't clear — let ActivePaddleScreen merge and clear when ready
    return { track, distKm: stats.distKm };
  } catch {
    return { track: [], distKm: 0 };
  }
}

/**
 * Clear background track buffer (call after merging into foreground state).
 */
export async function clearBackgroundTrack() {
  await AsyncStorage.multiRemove([BG_TRACK_KEY, BG_STATS_KEY]);
}
