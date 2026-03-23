/**
 * geocodingService — location search using OpenStreetMap Nominatim API.
 * No API key required. Free and open-source geocoding.
 *
 * Exports:
 *   searchLocations(query)   — search for places by name, returns array of results
 *   reverseGeocode(lat, lon) — convert coordinates to a place name
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'PaddleApp/1.0';

/** Minimum characters before triggering a search */
export const MIN_SEARCH_LENGTH = 3;

/** Debounce delay for search input (ms) */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Search for locations by name using Nominatim geocoding.
 * Returns an array of location results.
 *
 * @param {string} query — search text (e.g. "Bristol", "Lake District")
 * @param {number} [limit=5] — max number of results
 * @returns {Promise<Array<{
 *   displayName: string,
 *   label: string,
 *   lat: number,
 *   lng: number,
 *   type: string,
 *   importance: number
 * }>>}
 */
export async function searchLocations(query, limit = 5) {
  if (!query || query.trim().length < MIN_SEARCH_LENGTH) return [];

  const params = new URLSearchParams({
    q: query.trim(),
    format: 'json',
    limit: String(limit),
    addressdetails: '1',
  });

  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) throw new Error('Geocoding search failed');

  const data = await res.json();

  return data.map((item) => ({
    displayName: item.display_name,
    label: buildLabel(item),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    type: item.type || 'place',
    importance: item.importance || 0,
  }));
}

/**
 * Reverse geocode coordinates to a place name.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ displayName: string, label: string, lat: number, lng: number }>}
 */
export async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'json',
    addressdetails: '1',
  });

  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) throw new Error('Reverse geocoding failed');

  const item = await res.json();

  return {
    displayName: item.display_name,
    label: buildLabel(item),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  };
}

/**
 * Build a short, user-friendly label from Nominatim address data.
 * Prefers city/town/village + county/state format.
 */
function buildLabel(item) {
  const addr = item.address || {};
  const place =
    addr.city || addr.town || addr.village ||
    addr.hamlet || addr.suburb || addr.county || '';
  const region =
    addr.state || addr.county || addr.country || '';

  if (place && region && place !== region) {
    return `${place}, ${region}`;
  }
  return place || item.display_name?.split(',').slice(0, 2).join(',').trim() || 'Unknown';
}
