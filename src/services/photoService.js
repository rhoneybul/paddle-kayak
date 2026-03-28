// ── Photo service ─────────────────────────────────────────────────────────────
// Queries the Wikimedia Commons geo-search API for photos taken *at* the
// route's waypoint coordinates.  Because the waypoints are on the water,
// geo-tagged photos near them are far more likely to show the actual waterway
// than Wikipedia article lead images (which tend to show towns/buildings).

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Fetch photos geo-tagged near a single lat/lon from Wikimedia Commons.
 * Returns an array of { url, title } objects.
 */
async function fetchCommonsNear(lat, lon, radiusM = 5000, limit = 6) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({
      action:      'query',
      generator:   'geosearch',
      ggscoord:    `${lat}|${lon}`,
      ggsradius:   String(radiusM),
      ggslimit:    String(limit),
      ggsnamespace:'6',           // File: namespace only
      prop:        'imageinfo',
      iiprop:      'url|dimensions|mime',
      iiurlwidth:  '600',
      format:      'json',
      origin:      '*',
    });
    const res = await fetch(`${COMMONS_API}?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return [];

    return Object.values(pages)
      .filter(p => {
        const ii = p.imageinfo?.[0];
        if (!ii) return false;
        // Only JPEG/JPG — skip SVG diagrams, PNG icons, etc.
        if (!ii.mime?.startsWith('image/jpeg')) return false;
        // Skip very small thumbnails (likely icons)
        if (ii.width < 400 || ii.height < 300) return false;
        return true;
      })
      .map(p => ({
        url:   p.imageinfo[0].thumburl || p.imageinfo[0].url,
        title: p.title.replace(/^File:|_/g, ' ').trim(),
      }));
  } catch (e) {
    clearTimeout(timer);
    console.warn('[photoService] fetchCommonsNear failed:', e?.message);
    return [];
  }
}

/**
 * Fetch up to 3 photos for a route, sampled from waypoints on the water.
 * Falls back to locationCoords when no waypoints are present.
 * Returns [{ label, photos }] grouped by sample point.
 */
export async function fetchWaypointPhotos(route) {
  const rawWaypoints = Array.isArray(route.waypoints) ? route.waypoints : [];
  const wpts = rawWaypoints
    .map(w => (Array.isArray(w) ? { lat: w[0], lon: w[1] } : w))
    .filter(w => w?.lat != null && w?.lon != null);

  // Sample launch / mid / finish — or fall back to locationCoords
  const samples = [];
  if (wpts.length >= 2) {
    const pts = [wpts[0], wpts[Math.floor(wpts.length / 2)], wpts[wpts.length - 1]];
    pts.forEach((w, i) => {
      const label = i === 0 ? 'Launch' : i === pts.length - 1 ? 'Finish' : 'Midpoint';
      if (!samples.find(s => s.lat === w.lat && s.lon === w.lon)) {
        samples.push({ label, lat: w.lat, lon: w.lon });
      }
    });
  } else if (wpts.length === 1) {
    samples.push({ label: 'Route Area', lat: wpts[0].lat, lon: wpts[0].lon });
  } else if (route.locationCoords?.lat) {
    samples.push({
      label: route.name || 'Route Area',
      lat: route.locationCoords.lat,
      lon: route.locationCoords.lng ?? route.locationCoords.lon,
    });
  }

  if (samples.length === 0) return [];

  // Query each sample point — small radius since we want photos ON the water
  const results = await Promise.all(
    samples.map(({ label, lat, lon }) =>
      fetchCommonsNear(lat, lon, 8000, 4)
        .then(photos => ({ label, lat, lon, photos }))
    )
  );

  return results.filter(r => r.photos.length > 0);
}

/** Flat photo list — kept for any future callers. */
export async function fetchRoutePhotos(route) {
  const groups = await fetchWaypointPhotos(route);
  return groups.flatMap(g => g.photos);
}
