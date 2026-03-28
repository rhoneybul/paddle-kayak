/**
 * Water Routing — land-detection + shore/sea snapping using `is-sea`
 *
 * `is-sea` is a zero-cost, offline npm package that checks whether a
 * lat/lon coordinate is in the sea using bundled 10m-resolution map data.
 * No API key, no rate limits, no external calls.
 *
 * Launch (first) and finish (last) waypoints are snapped to the shoreline —
 * the sea point closest to land in the nearest coastal direction.
 *
 * Intermediate waypoints are kept in open water, snapped away from land.
 */

const isSea = require('is-sea');

const NUM_BEARINGS = 32; // 32 compass directions

// ── Intermediate waypoints: snap ONTO the sea ─────────────────────────────

const SEA_RADII = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1];

/**
 * If the point is on land, find the nearest sea cell by searching outward.
 * Returns the original point if it's already in the sea.
 */
function snapToSea(lat, lon) {
  if (isSea(lat, lon)) return [lat, lon];

  for (const r of SEA_RADII) {
    for (let b = 0; b < NUM_BEARINGS; b++) {
      const angle   = (b / NUM_BEARINGS) * 2 * Math.PI;
      const testLat = lat + r * Math.cos(angle);
      const testLon = lon + r * Math.sin(angle);
      if (isSea(testLat, testLon)) return [testLat, testLon];
    }
  }

  return [lat, lon]; // no sea found nearby — probably inland river/lake
}

// ── Launch / finish waypoints: snap TO the shoreline ─────────────────────

const SHORE_SEARCH_RADII = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2];

/**
 * Snap a launch/finish point to the sea-side of the nearest shoreline.
 *
 * Algorithm:
 *  1. Ensure we're starting from a sea point (snap if on land).
 *  2. Search outward in 32 directions to find the nearest land.
 *  3. Binary-search along that bearing to find the exact sea/land boundary.
 *  4. Return the sea-side boundary point.
 *
 * Falls back to the sea point from step 1 if no land is found nearby
 * (i.e. the route starts in open ocean — unusual for kayaking).
 */
function snapToShore(lat, lon) {
  // Step 1 — get a sea starting point
  let [seaLat, seaLon] = isSea(lat, lon) ? [lat, lon] : snapToSea(lat, lon);
  if (!isSea(seaLat, seaLon)) return [lat, lon]; // couldn't find sea at all

  // Step 2 — find the bearing and radius of the nearest land
  let nearestAngle  = null;
  let nearestRadius = Infinity;

  for (const r of SHORE_SEARCH_RADII) {
    for (let b = 0; b < NUM_BEARINGS; b++) {
      const angle   = (b / NUM_BEARINGS) * 2 * Math.PI;
      const testLat = seaLat + r * Math.cos(angle);
      const testLon = seaLon + r * Math.sin(angle);
      if (!isSea(testLat, testLon) && r < nearestRadius) {
        nearestRadius = r;
        nearestAngle  = angle;
      }
    }
    // Once we've checked a radius larger than the nearest land found, stop
    if (nearestRadius < Infinity && r > nearestRadius) break;
  }

  if (nearestAngle === null) return [seaLat, seaLon]; // open ocean

  // Step 3 — binary search along nearestAngle to find the exact boundary
  let lo = 0, hi = nearestRadius;
  let bestLat = seaLat, bestLon = seaLon;

  for (let i = 0; i < 16; i++) { // 16 iterations ≈ nearestRadius / 65536 precision
    const mid  = (lo + hi) / 2;
    const mLat = seaLat + mid * Math.cos(nearestAngle);
    const mLon = seaLon + mid * Math.sin(nearestAngle);
    if (isSea(mLat, mLon)) {
      bestLat = mLat;
      bestLon = mLon;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return [bestLat, bestLon];
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Validate and position all waypoints in a route:
 *  - First and last → snapped to the nearest shoreline (sea-side)
 *  - Intermediate   → snapped to open sea if on land
 *
 * @param {Array} waypoints  [[lat, lon], ...] or [{lat, lon}, ...]
 * @returns {[number, number][]}  cleaned waypoints in [lat, lon] format
 */
function refineRouteWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return waypoints;

  const pts = waypoints
    .map(w =>
      Array.isArray(w)
        ? [parseFloat(w[0]), parseFloat(w[1])]
        : [parseFloat(w.lat ?? w[0]), parseFloat(w.lon ?? w[1])],
    )
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));

  if (pts.length < 2) return waypoints;

  const last = pts.length - 1;

  const refined = pts.map(([lat, lon], i) => {
    if (i === 0 || i === last) return snapToShore(lat, lon); // shore
    return snapToSea(lat, lon);                               // open water
  });

  const snapped = pts.filter(([lat, lon], i) => {
    const [rLat, rLon] = refined[i];
    return lat !== rLat || lon !== rLon;
  }).length;

  if (snapped > 0) {
    console.log(`[waterRouting] adjusted ${snapped}/${pts.length} waypoints`);
  }

  return refined;
}

module.exports = { refineRouteWaypoints };
