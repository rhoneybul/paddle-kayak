/**
 * Live Activity service — manages iOS Live Activities for paddle tracking.
 *
 * On iOS 16.1+, this shows a persistent widget on the lock screen and
 * Dynamic Island with real-time paddle stats (distance, time, speed).
 *
 * Uses the native module exposed by the config plugin. Falls back gracefully
 * on platforms that don't support Live Activities (Android, web, older iOS).
 */
import { Platform, NativeModules, NativeEventEmitter } from 'react-native';

const { SolvaaLiveActivity } = NativeModules || {};

const isSupported = Platform.OS === 'ios' && !!SolvaaLiveActivity;

/**
 * Start a Live Activity for an active paddle.
 * @param {{ paddleName: string, routeName?: string }} params
 * @returns {Promise<boolean>} true if started successfully
 */
export async function startLiveActivity({ paddleName, routeName } = {}) {
  if (!isSupported) return false;
  try {
    await SolvaaLiveActivity.start({
      paddleName: paddleName || 'Paddle',
      routeName: routeName || '',
      distanceKm: 0,
      elapsedSeconds: 0,
      speedKmh: 0,
    });
    return true;
  } catch (e) {
    console.warn('[LiveActivity] start failed:', e?.message);
    return false;
  }
}

/**
 * Update the Live Activity with current paddle stats.
 * Call this every few seconds during tracking.
 */
export async function updateLiveActivity({ distanceKm, elapsedSeconds, speedKmh }) {
  if (!isSupported) return;
  try {
    await SolvaaLiveActivity.update({
      distanceKm: distanceKm || 0,
      elapsedSeconds: elapsedSeconds || 0,
      speedKmh: speedKmh || 0,
    });
  } catch {
    // Silently fail — don't interrupt the paddle
  }
}

/**
 * End the Live Activity (paddle finished or cancelled).
 * @param {{ distanceKm: number, elapsedSeconds: number }} finalStats
 */
export async function endLiveActivity({ distanceKm, elapsedSeconds } = {}) {
  if (!isSupported) return;
  try {
    await SolvaaLiveActivity.end({
      distanceKm: distanceKm || 0,
      elapsedSeconds: elapsedSeconds || 0,
    });
  } catch {
    // Silently fail
  }
}

/** Check if Live Activities are supported on this device. */
export function liveActivitySupported() {
  return isSupported;
}
