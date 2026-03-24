/**
 * geocodingService — location search using Photon (komoot.io), an open-source
 * geocoder based on OpenStreetMap data. Significantly better result quality
 * than plain Nominatim. No API key required.
 * Falls back to Nominatim for reverse geocoding.
 */

export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;

const PHOTON_BASE   = 'https://photon.komoot.io';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT    = 'PaddleApp/1.0';

/**
 * Search for locations. Returns up to `limit` results sorted by relevance.
 */
export async function searchLocations(query, limit = 6) {
  if (!query || query.trim().length < MIN_SEARCH_LENGTH) return [];

  const params = new URLSearchParams({ q: query.trim(), limit: String(limit), lang: 'en' });
  const res = await fetch(`${PHOTON_BASE}/api/?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error('Geocoding search failed');

  const data = await res.json();
  if (!Array.isArray(data.features)) return [];

  return data.features
    .filter(f => f.geometry?.coordinates?.length === 2)
    .map(f => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const label = buildPhotonLabel(p);
      return {
        displayName: label,
        label,
        lat,
        lng,
        type: p.type || p.osm_value || 'place',
      };
    })
    .filter(r => r.label);
}

/**
 * Reverse geocode via Nominatim (richer address data than Photon reverse).
 */
export async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json', addressdetails: '1' });
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const item = await res.json();
  const addr = item.address || {};
  const place = addr.city || addr.town || addr.village || addr.hamlet || addr.county || '';
  const region = addr.state || addr.county || addr.country || '';
  const label = place && region && place !== region ? `${place}, ${region}` : place || item.display_name?.split(',')[0] || '';
  return { displayName: item.display_name, label, lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
}

function buildPhotonLabel(p) {
  const parts = [];
  if (p.name && p.name !== p.city && p.name !== p.town) parts.push(p.name);
  const locality = p.city || p.town || p.village || p.county || '';
  if (locality) parts.push(locality);
  if (p.state && p.state !== locality) parts.push(p.state);
  if (p.country && parts.length < 3) parts.push(p.country);
  return parts.join(', ');
}
