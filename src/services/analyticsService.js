import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const QUEUE_KEY = 'SOLVAA_ANALYTICS_QUEUE';
const IDENTITY_KEY = 'SOLVAA_ANALYTICS_IDENTITY';
const FLUSH_INTERVAL_MS = 30000;

/**
 * Lightweight event tracking service.
 *
 * Key event names:
 *   search_started, search_completed,
 *   route_saved, route_deleted,
 *   paddle_started, paddle_completed, paddle_deleted,
 *   feedback_submitted,
 *   collection_created, collection_deleted,
 *   photo_loaded,
 *   poi_searched
 */

let flushTimer = null;

function startAutoFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush();
  }, FLUSH_INTERVAL_MS);
}

async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue) {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // silent fail
  }
}

/**
 * Queue an analytics event.
 * @param {string} eventName
 * @param {object} [properties={}]
 */
export async function track(eventName, properties = {}) {
  startAutoFlush();

  const identity = await getIdentity();
  const event = {
    event: eventName,
    properties,
    userId: identity?.userId || null,
    timestamp: new Date().toISOString(),
  };

  const queue = await getQueue();
  queue.push(event);
  await saveQueue(queue);
}

/**
 * Store the current user identity for attaching to future events.
 * @param {string} userId
 * @param {object} [traits={}]
 */
export async function identify(userId, traits = {}) {
  try {
    await AsyncStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ userId, traits, identifiedAt: new Date().toISOString() })
    );
  } catch {
    // silent fail
  }
}

async function getIdentity() {
  try {
    const raw = await AsyncStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Send all queued events to the server. Best-effort, silent fail.
 */
export async function flush() {
  const queue = await getQueue();
  if (queue.length === 0) return;

  // Clear the queue optimistically so new events aren't lost on failure
  await saveQueue([]);

  try {
    const identity = await getIdentity();
    await fetch(`${BASE_URL}/api/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: queue, identity }),
    });
  } catch {
    // Best-effort: re-queue events on failure so they can be retried
    const current = await getQueue();
    await saveQueue([...queue, ...current]);
  }
}

// Kick off auto-flush on import
startAutoFlush();

export default { track, identify, flush };
