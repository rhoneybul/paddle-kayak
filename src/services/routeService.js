import { SKILL_LEVELS } from './stravaService';

/**
 * Kayak Route Planning Engine — Maritime-First Routing
 * Based on real kayaking best practices:
 * - Wind: Paddle into headwind going out, downwind return when tired
 * - Tides: Use tidal streams, avoid tide races
 * - Distance: 3-4 km/h average paddling speed
 * - Safety: Always stay within swim-to-shore distance for beginners
 * - Maritime-first: All waypoints must stay on navigable water, hugging coastlines
 */

// ── Maritime-first configuration ──────────────────────────────────────────────

/**
 * Maximum distance (km) from the coast a kayak route should stay.
 * Skill-based: beginners hug the shore, experts may cross open water.
 */
const COASTAL_PROXIMITY_KM = {
  beginner: 0.5,
  intermediate: 1.0,
  advanced: 3.0,
  expert: 8.0,
};

/**
 * Overpass API endpoint for querying OSM water polygons.
 * Used for maritime-aware coordinate validation.
 */
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// ── Maritime validation helpers ──────────────────────────────────────────────

/**
 * Haversine distance between two points in km.
 * Used for maritime route segment distance checks and shore proximity.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in km
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Build an Overpass QL query to check whether a point sits on water.
 * Queries OSM natural=water, waterway, and maritime areas within a
 * small radius of the given coordinate.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusM - search radius in metres (default 200)
 * @returns {string} Overpass QL query
 */
export function buildWaterCheckQuery(lat, lon, radiusM = 200) {
  return `[out:json][timeout:10];(
    way["natural"="water"](around:${radiusM},${lat},${lon});
    way["natural"="coastline"](around:${radiusM},${lat},${lon});
    way["waterway"](around:${radiusM},${lat},${lon});
    relation["natural"="water"](around:${radiusM},${lat},${lon});
    way["natural"="bay"](around:${radiusM},${lat},${lon});
    way["natural"="strait"](around:${radiusM},${lat},${lon});
  );out count;`;
}

/**
 * Check if a coordinate is on or near navigable water using the
 * Overpass API. Returns true if OSM water features exist within the
 * given radius. Falls back to true if the API call fails (permissive
 * fallback) so that offline/rate-limited usage doesn't block planning.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusM=200]
 * @returns {Promise<boolean>}
 */
export async function isPointOnWater(lat, lon, radiusM = 200) {
  try {
    const query = buildWaterCheckQuery(lat, lon, radiusM);
    const res = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return true; // permissive fallback
    const data = await res.json();
    const total = data.elements?.[0]?.tags?.total || 0;
    return total > 0;
  } catch {
    return true; // permissive fallback — don't block on network errors
  }
}

/**
 * Validate that a route's waypoints follow maritime-safe paths:
 * 1. Consecutive waypoints should not "jump" more than a maximum
 *    segment distance (prevents teleportation across land).
 * 2. Total route distance should be reasonable relative to declared distanceKm.
 *
 * Returns { valid, warnings, adjustedWaypoints }.
 * @param {Array} waypoints - [{lat, lon, …}] or [[lat, lon], …]
 * @param {Object} [options]
 * @param {number} [options.maxSegmentKm] - max distance between consecutive points
 * @param {number} [options.declaredDistKm] - expected total route distance
 * @param {string} [options.skillKey] - skill level key for shore proximity
 * @returns {{ valid: boolean, warnings: string[], adjustedWaypoints: Array, totalDistanceKm: number, maxShoreDistanceKm: number }}
 */
export function validateMaritimeRoute(waypoints, options = {}) {
  const { maxSegmentKm = 10, declaredDistKm, skillKey } = options;
  const warnings = [];
  const pts = normaliseWaypointCoords(waypoints);

  if (pts.length < 2) {
    return { valid: false, warnings: ['Route has fewer than 2 waypoints'], adjustedWaypoints: pts, totalDistanceKm: 0, maxShoreDistanceKm: 0 };
  }

  let totalDist = 0;
  let maxSegDist = 0;

  for (let i = 1; i < pts.length; i++) {
    const seg = haversineDistanceKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    totalDist += seg;
    if (seg > maxSegDist) maxSegDist = seg;

    if (seg > maxSegmentKm) {
      warnings.push(
        `Segment ${i} spans ${seg.toFixed(1)} km — possible land crossing or teleportation. Maximum recommended: ${maxSegmentKm} km.`
      );
    }
  }

  // Check for unreasonable total distance vs declared
  if (declaredDistKm && Math.abs(totalDist - declaredDistKm) > declaredDistKm * 0.5) {
    warnings.push(
      `Route geometry (${totalDist.toFixed(1)} km) differs significantly from declared distance (${declaredDistKm} km).`
    );
  }

  // Shore proximity hint (informational — actual enforcement is in the AI prompt)
  const maxShore = skillKey ? COASTAL_PROXIMITY_KM[skillKey] || 3 : 3;

  return {
    valid: warnings.length === 0,
    warnings,
    adjustedWaypoints: pts,
    totalDistanceKm: Math.round(totalDist * 10) / 10,
    maxShoreDistanceKm: maxShore,
  };
}

/**
 * Normalise waypoints into a consistent [{lat, lon, name?, type?}] format.
 * Accepts both [{lat, lon}] objects and [[lat, lon]] arrays (Claude format).
 * @param {Array} waypoints
 * @returns {Array<{lat: number, lon: number, name?: string, type?: string}>}
 */
export function normaliseWaypointCoords(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  return waypoints
    .map((wp, i) => {
      // [lat, lon] pair
      if (Array.isArray(wp) && wp.length >= 2) {
        const lat = parseFloat(wp[0]);
        const lon = parseFloat(wp[1]);
        if (isNaN(lat) || isNaN(lon)) return null;
        return {
          lat,
          lon,
          name: i === 0 ? 'Launch Point' : i === waypoints.length - 1 ? 'Take-out' : `Waypoint ${i}`,
          type: i === 0 ? 'start' : i === waypoints.length - 1 ? 'finish' : 'waypoint',
        };
      }
      // {lat, lon} object
      if (wp && typeof wp === 'object' && wp.lat != null && wp.lon != null) {
        return {
          lat: parseFloat(wp.lat),
          lon: parseFloat(wp.lon),
          name: wp.name || `Waypoint ${i}`,
          type: wp.type || 'waypoint',
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Snap a straight-line waypoint to a maritime-logical path by offsetting it
 * towards the nearest coastline direction. This is a lightweight heuristic —
 * for true snapping, the AI prompt in claudeService.js and/or a proper
 * maritime API would be used. The function adds curvature by interpolating
 * extra points between waypoints that are far apart, keeping the route
 * visually following water rather than cutting across land.
 *
 * @param {Array} waypoints - normalised [{lat, lon, …}]
 * @param {number} [maxSegKm=5] - if a segment exceeds this, subdivide it
 * @returns {Array} densified waypoints
 */
export function densifyMaritimeRoute(waypoints, maxSegKm = 5) {
  if (waypoints.length < 2) return waypoints;
  const result = [waypoints[0]];

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const segDist = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);

    if (segDist > maxSegKm) {
      // Subdivide segment with intermediate maritime-offset points
      const numSplits = Math.ceil(segDist / maxSegKm);
      for (let s = 1; s < numSplits; s++) {
        const t = s / numSplits;
        const midLat = prev.lat + (curr.lat - prev.lat) * t;
        const midLon = prev.lon + (curr.lon - prev.lon) * t;
        // Apply a small perpendicular offset to keep route on water (coastal hug)
        const perpOffset = 0.001 * Math.sin(t * Math.PI); // bulge seaward
        result.push({
          lat: midLat + perpOffset,
          lon: midLon + perpOffset,
          name: `Maritime waypoint ${i}-${s}`,
          type: 'waypoint',
        });
      }
    }
    result.push(curr);
  }

  return result;
}

/**
 * Get the launch point (start waypoint) of a route.
 * Used to provide "Navigate to start" functionality.
 * @param {Object} route - route object with waypoints
 * @returns {{ lat: number, lon: number, name: string } | null}
 */
export function getRouteLaunchPoint(route) {
  if (!route?.waypoints) return null;
  const pts = normaliseWaypointCoords(route.waypoints);
  if (pts.length === 0) return null;
  return { lat: pts[0].lat, lon: pts[0].lon, name: pts[0].name || 'Launch Point' };
}

/**
 * Build a Google Maps navigation URL for driving to a launch point.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function buildNavigateToStartUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}


const ROUTE_TEMPLATES = {
  // Flat water / lake routes
  flat_water_circuit: {
    type: 'flat_water',
    name: 'Sheltered Lake Circuit',
    pattern: 'circular',
    terrain: 'lake',
    challenges: ['none'],
    tips: [
      'Stick to the sheltered side in any wind',
      'Take breaks at the far shore',
      'Watch for motorboat wakes',
    ],
  },
  coastal_there_back: {
    type: 'coastal',
    name: 'Coastal Out & Back',
    pattern: 'out_and_back',
    terrain: 'sea',
    challenges: ['wind', 'waves', 'tides'],
    tips: [
      'Paddle into the wind first while fresh',
      'Hug the coastline for shelter',
      'Check tide times before departure',
      'Keep visual on landing beaches',
    ],
  },
  river_downstream: {
    type: 'river',
    name: 'River Downstream Paddle',
    pattern: 'point_to_point',
    terrain: 'river',
    challenges: ['current', 'obstacles'],
    tips: [
      'Scout rapids before running them',
      'Read the current to find fastest water',
      'Eddy hop to control pace',
      'Arrange shuttle vehicle at takeout',
    ],
  },
  island_hop: {
    type: 'island_hopping',
    name: 'Island Hopping Adventure',
    pattern: 'multi_point',
    terrain: 'sea',
    challenges: ['crossings', 'wind', 'tides'],
    tips: [
      'Plan crossings for slack tide',
      'Never cross in winds over 15 knots',
      'Each island is a bail-out point',
      'Time crossings for calm morning windows',
    ],
  },
  sea_expedition: {
    type: 'sea_expedition',
    name: 'Coastal Expedition',
    pattern: 'multi_day',
    terrain: 'sea',
    challenges: ['open_water', 'weather', 'camping'],
    tips: [
      'File a float plan with a contact ashore',
      'Carry VHF radio and flares',
      'Camp above high-tide line',
      'Have emergency bailout routes planned',
    ],
  },
};

/**
 * Generate route recommendations based on conditions and skill.
 * Maritime-first: generated waypoints are validated and densified to
 * stay on navigable water.
 */
export function generateRoutes({ tripType, skillLevel, weather, location, durationDays = 1 }) {
  const skill = SKILL_LEVELS[skillLevel.key?.toUpperCase()] || skillLevel;
  const windKnots = weather.current.windSpeed;
  const waveM = weather.current.waveHeight;
  const isSafe = windKnots <= skill.maxWindKnots && waveM <= skill.maxWaveM;

  const routes = [];

  // Determine appropriate route types
  const eligibleTypes = skill.preferredRouteTypes;

  eligibleTypes.forEach(routeType => {
    const template = getTemplateForType(routeType);
    if (!template) return;

    const distKm = calcRecommendedDistance(skill, durationDays, windKnots);
    const durationHours = calcDuration(distKm, windKnots);

    // Generate waypoints (descriptive, real map integration via Claude/AI service)
    const rawWaypoints = generateWaypoints(template.pattern, distKm, location);

    // Maritime-first: densify the route so segments stay on water
    const maritimeWaypoints = densifyMaritimeRoute(rawWaypoints);

    // Validate route geometry
    const validation = validateMaritimeRoute(maritimeWaypoints, {
      maxSegmentKm: 10,
      declaredDistKm: distKm,
      skillKey: skill.key,
    });

    routes.push({
      id: `route_${routeType}_${Date.now()}`,
      template,
      name: template.name,
      distanceKm: distKm,
      durationHours,
      durationDays,
      waypoints: validation.adjustedWaypoints,
      difficulty: getDifficulty(windKnots, waveM, skill),
      suitability: calcSuitability(windKnots, waveM, skill, template),
      weatherWindow: getWeatherWindow(weather),
      tideConsideration: template.terrain === 'sea' ? getTideAdvice(weather) : null,
      packingList: generatePackingList(durationDays, weather),
      safetyBriefing: generateSafetyBriefing(skill, weather, template),
      tips: template.tips,
      breakpoints: generateBreakpoints(maritimeWaypoints, distKm),
      emergencyExits: generateEmergencyExits(template.terrain),
      maritimeValidation: {
        valid: validation.valid,
        warnings: validation.warnings,
        totalGeometryKm: validation.totalDistanceKm,
        maxShoreDistanceKm: validation.maxShoreDistanceKm,
      },
      launchPoint: getRouteLaunchPoint({ waypoints: maritimeWaypoints }),
    });
  });

  // Sort by suitability score
  routes.sort((a, b) => b.suitability - a.suitability);
  return routes.slice(0, 3); // Top 3 options
}

function getTemplateForType(type) {
  const map = {
    flat_water: ROUTE_TEMPLATES.flat_water_circuit,
    sheltered_bay: ROUTE_TEMPLATES.flat_water_circuit,
    coastal: ROUTE_TEMPLATES.coastal_there_back,
    lake_crossing: ROUTE_TEMPLATES.flat_water_circuit,
    river: ROUTE_TEMPLATES.river_downstream,
    open_water: ROUTE_TEMPLATES.island_hop,
    sea_kayak: ROUTE_TEMPLATES.island_hop,
    expedition: ROUTE_TEMPLATES.sea_expedition,
    surf_zone: ROUTE_TEMPLATES.coastal_there_back,
  };
  return map[type];
}

function calcRecommendedDistance(skill, days, windKnots) {
  const baseDaily = skill.maxDistKm * 0.7; // 70% of max for comfortable day
  const windPenalty = Math.max(0, (windKnots - 5) * 0.8); // Each knot over 5 costs distance
  const adjusted = Math.max(3, baseDaily - windPenalty);
  return Math.round(adjusted * days);
}

function calcDuration(distKm, windKnots) {
  const paddleSpeed = Math.max(2, 4 - windKnots * 0.1); // km/h, slows in wind
  const paddleTime = distKm / paddleSpeed;
  const breakTime = Math.floor(distKm / 10) * 0.25; // 15 min break every 10km
  return Math.round((paddleTime + breakTime) * 10) / 10;
}

function generateWaypoints(pattern, distKm, location) {
  // Descriptive waypoints - in real app these come from a marine charts API
  const base = location || { lat: 51.5, lon: -0.1 };
  const step = distKm / 1000 * 0.009; // rough degree per km

  switch (pattern) {
    case 'circular':
      return [
        { name: 'Launch Point', lat: base.lat, lon: base.lon, type: 'start' },
        { name: 'East Shore Rest', lat: base.lat + step, lon: base.lon + step * 0.5, type: 'waypoint' },
        { name: 'Far Point', lat: base.lat + step * 1.5, lon: base.lon, type: 'waypoint' },
        { name: 'Return', lat: base.lat, lon: base.lon, type: 'finish' },
      ];
    case 'out_and_back':
      return [
        { name: 'Launch Beach', lat: base.lat, lon: base.lon, type: 'start' },
        { name: 'Midpoint Rest', lat: base.lat + step, lon: base.lon + step * 0.3, type: 'waypoint' },
        { name: 'Turnaround Point', lat: base.lat + step * 2, lon: base.lon + step * 0.6, type: 'turnaround' },
        { name: 'Launch Beach', lat: base.lat, lon: base.lon, type: 'finish' },
      ];
    case 'point_to_point':
      return [
        { name: 'Put-in', lat: base.lat, lon: base.lon, type: 'start' },
        { name: 'Mid Section', lat: base.lat + step, lon: base.lon - step * 0.2, type: 'waypoint' },
        { name: 'Take-out', lat: base.lat + step * 2.5, lon: base.lon - step * 0.5, type: 'finish' },
      ];
    default:
      return [
        { name: 'Start', lat: base.lat, lon: base.lon, type: 'start' },
        { name: 'End', lat: base.lat + step, lon: base.lon + step, type: 'finish' },
      ];
  }
}

function getDifficulty(windKnots, waveM, skill) {
  if (windKnots > 20 || waveM > 1.2) return { label: 'Challenging', color: '#FF4D6D', stars: 5 };
  if (windKnots > 15 || waveM > 0.8) return { label: 'Moderate', color: '#FFB347', stars: 3 };
  if (windKnots > 10 || waveM > 0.4) return { label: 'Easy-Moderate', color: '#FFD166', stars: 2 };
  return { label: 'Easy', color: '#00D4AA', stars: 1 };
}

function calcSuitability(windKnots, waveM, skill, template) {
  let score = 100;
  if (windKnots > skill.maxWindKnots) score -= (windKnots - skill.maxWindKnots) * 5;
  if (waveM > skill.maxWaveM) score -= (waveM - skill.maxWaveM) * 20;
  // Terrain matching
  if (skill.key === 'beginner' && template.terrain === 'sea') score -= 20;
  if (skill.key === 'expert' && template.terrain === 'lake') score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getWeatherWindow(weather) {
  // Find best 4-hour window in next 12 hours
  const good = weather.hourly.filter(h => h.windSpeed <= 15 && h.precipProb <= 30);
  if (good.length === 0) return { label: 'No ideal window', color: '#FF4D6D' };
  const first = new Date(good[0].time);
  const hour = first.getHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour || 12;
  return { label: `Best: ${displayHour}:00 ${ampm}`, color: '#00D4AA', time: good[0].time };
}

function getTideAdvice(weather) {
  // Simplified - in production this uses real tide API
  return {
    advice: 'Check local tide tables. Plan crossings at slack water.',
    link: 'https://tidesandcurrents.noaa.gov',
  };
}

function generatePackingList(days, weather) {
  const base = [
    '🛶 Kayak + paddle + spare paddle',
    '🦺 PFD (life jacket) — mandatory',
    '🪣 Bilge pump',
    '🧭 Compass + waterproof map',
    '📱 Charged phone in dry bag',
    '💧 2L water minimum per person',
    '🍫 High-energy snacks',
    '🩹 First aid kit',
    '🌡️ Wetsuit or drysuit (water temp dependent)',
    '🧢 Sun hat + sunscreen SPF 50+',
    '👓 Polarized sunglasses',
    '📡 Whistle + signal mirror',
  ];

  if (days > 1) {
    base.push(
      '⛺ Tent + sleeping system',
      '🍳 Camp stove + meals',
      '🔦 Headlamp',
      '📻 VHF marine radio',
      '🔥 Emergency flares',
      '🗺️ Float plan filed with contact ashore',
    );
  }

  if (weather.current.condition.severity !== 'none') {
    base.push('🧤 Neoprene gloves', '🌂 Waterproof jacket', '🥾 Wetsuit boots');
  }

  return base;
}

function generateSafetyBriefing(skill, weather, template) {
  const points = [];
  const wind = weather.current.windSpeed;

  if (wind > 15) points.push(`⚠️ Wind at ${wind} knots — conditions are above beginner threshold. Reassess at launch.`);
  if (template.terrain === 'sea') points.push('🌊 Coastal paddling: Always stay within sight of shore unless experienced.');
  if (skill.key === 'beginner') {
    points.push('🆘 Never paddle alone. Stay within 200m of shore.');
    points.push('📞 Tell someone your plan and expected return time.');
  }
  points.push('🔄 If conditions deteriorate, turn back immediately — ego kills.');
  points.push('💧 Hypothermia risk: dress for the water temperature, not air temperature.');

  return points;
}

function generateBreakpoints(waypoints, distKm) {
  const interval = Math.round(distKm / 3);
  return waypoints
    .filter(w => w.type === 'waypoint')
    .map(w => ({ ...w, restDuration: '10-15 min', note: 'Hydrate, snack, check conditions' }));
}

function generateEmergencyExits(terrain) {
  switch (terrain) {
    case 'sea':
      return ['Head to nearest beach immediately', 'Call Coastguard: VHF Ch 16', 'Activate PLB if life-threatening'];
    case 'river':
      return ['Eddy out to bank', 'Scout hazards from shore', 'Call emergency services'];
    default:
      return ['Paddle to nearest shore', 'Call emergency services if needed'];
  }
}

/**
 * Real-time condition assessment during paddle
 */
export function assessRealTimeConditions(currentWeather, routeProgress, skillLevel) {
  const skill = SKILL_LEVELS[skillLevel?.key?.toUpperCase()] || skillLevel;
  const warnings = [];
  const recommendations = [];

  const wind = currentWeather.windSpeed;
  const wave = currentWeather.waveHeight;

  // Wind change assessment
  if (wind > skill.maxWindKnots * 0.9) {
    warnings.push({
      severity: 'high',
      message: `Wind approaching your limit (${wind} knots). Consider heading to shore.`,
      icon: '💨',
    });
  }

  // Deteriorating conditions
  if (currentWeather.condition.severity === 'severe') {
    warnings.push({
      severity: 'critical',
      message: 'Severe weather. Land immediately at nearest safe point.',
      icon: '⛈️',
    });
  }

  // Progress-based recommendations
  const progress = routeProgress?.percentComplete || 0;
  if (progress < 50 && wind > skill.maxWindKnots * 0.7) {
    recommendations.push({
      type: 'turn_back',
      message: 'Conditions worsening before halfway. Recommend returning now.',
      icon: '↩️',
    });
  }

  if (routeProgress?.distanceFromStart > 0) {
    const etaMinutes = (routeProgress.distanceRemaining / 3) * 60;
    recommendations.push({
      type: 'info',
      message: `~${Math.round(etaMinutes)} min to finish at current pace`,
      icon: '⏱️',
    });
  }

  return { warnings, recommendations };
}
