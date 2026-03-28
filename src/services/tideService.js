// ── WorldTides API v3 ─────────────────────────────────────────────────────────
// Requires EXPO_PUBLIC_WORLDTIDES_API_KEY
// Sign up free at https://www.worldtides.info/developer
//
// fetchTides returns:
//   heights:  [{ dt, height }]   — hourly heights in metres (MSL)
//   extremes: [{ dt, height, type }] — "High" | "Low" events

const API_KEY = process.env.EXPO_PUBLIC_WORLDTIDES_API_KEY || '';
const BASE    = 'https://www.worldtides.info/api/v3';

/**
 * Fetch tide heights + extremes for a location.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string} dateStr  YYYY-MM-DD  start date (today by default)
 * @param {number} days     number of days to fetch (default 7)
 * @returns {{ heights: Array, extremes: Array } | null}
 */
export async function fetchTides(lat, lon, dateStr = null, days = 7) {
  if (!API_KEY) return null;

  const date = dateStr ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const url =
    `${BASE}?heights&extremes` +
    `&lat=${lat}&lon=${lon}` +
    `&date=${date}` +
    `&days=${days}` +
    `&step=3600` +       // hourly heights
    `&key=${API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[tideService] WorldTides API error:', res.status);
      return null;
    }
    const data = await res.json();
    if (data.status !== 200) {
      console.warn('[tideService] WorldTides response status:', data.status, data.error);
      return null;
    }
    return {
      heights:  data.heights  || [],
      extremes: data.extremes || [],
    };
  } catch (e) {
    console.warn('[tideService] fetch failed:', e?.message);
    return null;
  }
}

/**
 * Convert a WorldTides Unix timestamp (seconds) to a local-time ISO hour key
 * matching the format Open-Meteo uses: "YYYY-MM-DDTHH:00".
 *
 * @param {number} dt              Unix timestamp in seconds
 * @param {number} utcOffsetSeconds  from weather.utcOffsetSeconds (e.g. 3600 for UTC+1)
 */
function dtToLocalKey(dt, utcOffsetSeconds) {
  // Shift into local time, then read UTC fields (which now represent local time)
  const localMs = dt * 1000 + utcOffsetSeconds * 1000;
  const d = new Date(localMs);
  const Y  = d.getUTCFullYear();
  const M  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const D  = String(d.getUTCDate()).padStart(2, '0');
  const H  = String(d.getUTCHours()).padStart(2, '0');
  return `${Y}-${M}-${D}T${H}:00`;
}

/**
 * Convert WorldTides heights array to a lookup map keyed by local ISO hour string
 * (matching the format used in weatherService hourly data: "YYYY-MM-DDTHH:00").
 *
 * @param {Array}  heights          from fetchTides()
 * @param {number} utcOffsetSeconds from weather.utcOffsetSeconds
 * @returns {Object}  e.g. { "2024-03-15T09:00": 1.23, ... }
 */
export function buildTideHeightMap(heights = [], utcOffsetSeconds = 0) {
  const map = {};
  for (const { dt, height } of heights) {
    map[dtToLocalKey(dt, utcOffsetSeconds)] = height;
  }
  return map;
}

/**
 * Build a lookup map of extremes keyed by local ISO hour string.
 * Each entry: { height, type } where type is "High" or "Low".
 * Extremes rarely fall exactly on the hour — snap each to the nearest hour.
 */
/** Convert a WorldTides Unix timestamp to a local "HH:MM" string. */
function dtToLocalTime(dt, utcOffsetSeconds) {
  const localMs = dt * 1000 + utcOffsetSeconds * 1000;
  const d = new Date(localMs);
  const H = String(d.getUTCHours()).padStart(2, '0');
  const M = String(d.getUTCMinutes()).padStart(2, '0');
  return `${H}:${M}`;
}

export function buildTideExtremeMap(extremes = [], utcOffsetSeconds = 0) {
  const map = {};
  for (const { dt, height, type } of extremes) {
    // Round to nearest hour for the lookup key, but keep exact time for display
    const roundedDt = Math.round(dt / 3600) * 3600;
    map[dtToLocalKey(roundedDt, utcOffsetSeconds)] = {
      height,
      type,
      exactTime: dtToLocalTime(dt, utcOffsetSeconds),
    };
  }
  return map;
}
