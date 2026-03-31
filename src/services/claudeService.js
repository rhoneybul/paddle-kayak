/**
 * Claude API service — enhanced with weather-aware 3-route planning
 * Reads EXPO_PUBLIC_CLAUDE_API_KEY from .env
 *
 * Exports:
 *   hasApiKey()                  — true when a valid key is configured
 *   planPaddle(userPrompt)       — legacy single-prompt planning
 *   planPaddleWithWeather(opts)  — new: returns 3 distinct route options with
 *                                  weather analysis and GPX waypoints
 *
 * Route response schema (per route):
 * {
 *   name:                  string   — e.g. "Scenic Estuary Loop"
 *   description:           string   — 1-2 sentence overview
 *   difficulty_rating:     string   — one of: beginner | intermediate | advanced | expert
 *   estimated_duration:    number   — hours
 *   waypoints:             [lat,lon][] — array of [lat, lon] coordinate pairs
 *   weather_impact_summary:string   — how current forecast affects this route
 *   distanceKm:            number
 *   terrain:               string   — coastal | river | lake | estuary
 *   why:                   string   — why this route suits the request
 *   travelFromBase:        string
 *   travelTimeMin:         number
 *   highlights:            string[]
 *   launchPoint:           string
 *   bestConditions:        string
 * }
 */

import { SKILL_LEVELS } from './stravaService';
import { getWeatherWithCache } from './weatherService';


/** Default request timeout in ms (120 seconds — Claude with GPX routes can be slow). */
const REQUEST_TIMEOUT_MS = 120000;

/** Backend API base URL — override via EXPO_PUBLIC_API_URL env var. */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';


// ── Skill-level description block used inside the system prompt ──────────────
const SKILL_LEVEL_CONTEXT = Object.values(SKILL_LEVELS)
  .map(
    (s) =>
      `- ${s.key}: ${s.description} (max wind ${s.maxWindKnots} kt, max wave ${s.maxWaveM} m, max distance ${s.maxDistKm} km)`,
  )
  .join('\n');

// ── System prompt for three-route weather-aware planning ─────────────────────
const SYSTEM_PROMPT_THREE_ROUTES = `You are a kayaking trip planner assistant built into the Solvaa app.

When a user describes a paddle they want to do you MUST respond with a JSON object containing between 5 and 8 distinct route options. Include a wide spread of difficulty levels (beginner through expert) and distance (short 2-5 km to long 15+ km). Order them from easiest/shortest to hardest/longest. Make each route genuinely different — different launch point, different character, different stretch of water.

SKILL LEVELS (align difficulty_rating to these):
${SKILL_LEVEL_CONTEXT}

WEATHER CONTEXT will be injected below. Use it to:
- Warn about unsafe conditions per route
- Suggest the best departure window
- Note wind direction impact on each route

Respond ONLY with a valid JSON object (no markdown, no backticks, no preamble) in this exact structure:
{
  "understood": "One sentence confirming what you understood",
  "location": {
    "base": "City/town",
    "searchRadius": number,
    "transport": "own car | public transport | unknown",
    "lat": number,
    "lon": number
  },
  "trip": {
    "type": "day_paddle | weekend | week | multi_day",
    "durationHours": number or null,
    "durationDays": number or null,
    "paddlingHoursPerDay": number
  },
  "conditions": {
    "skillLevel": "beginner | intermediate | advanced | expert | unknown",
    "terrainPreference": "coastal | river | lake | any",
    "sheltered": true or false
  },
  "routes": [
    {
      "name": "Route name (include style e.g. Scenic Estuary Loop)",
      "description": "1-2 sentence overview of the route",
      "difficulty_rating": "beginner | intermediate | advanced | expert",
      "estimated_duration": number,
      "waypoints": "REPLACE_WITH_REAL_COORDS — see IMPORTANT section below",
      "weather_impact_summary": "How current weather affects this route specifically",
      "distanceKm": number,
      "terrain": "coastal | river | lake | estuary",
      "why": "One sentence why this suits the paddler",
      "travelFromBase": "How to get there",
      "travelTimeMin": number,
      "highlights": ["highlight 1", "highlight 2"],
      "launchPoint": "Specific put-in name",
      "bestConditions": "Wind/tide advice"
    }
  ],
  "campsites": [
    {
      "name": "Campsite name",
      "nearRoute": "Route name",
      "distanceFromWaterKm": number,
      "type": "beach | formal | wild",
      "notes": "Brief note"
    }
  ],
  "weatherNote": "General weather note",
  "packingHighlights": ["item 1","item 2","item 3","item 4","item 5"],
  "safetyNote": "Safety note relevant to current conditions"
}

CRITICAL — MARITIME-FIRST WAYPOINTS:
- "waypoints" MUST be a JSON array of [latitude, longitude] number pairs. Use your geographic knowledge to place each point accurately.
- NEVER use or anchor to example coordinates.
- ALL points MUST be on navigable water (sea, river, lake, estuary). NEVER place any point on land, roads, buildings, or above the high-water mark.
- The first point must be at a REAL launch location on the water's edge (boat ramp, beach, slipway, marina). The last point must be at a REAL take-out on the water's edge.
- CRITICAL POINTS ONLY — do NOT include evenly spaced filler points:
  * Include the launch point (first waypoint)
  * Include any significant navigation turning points — where the route changes direction by more than ~40°, e.g. rounding a headland, entering a bay, crossing a channel, reaching a turnaround point
  * Include the take-out or end point (last waypoint)
  * For loops or circumnavigations, include the key corner/apex points around the island or headland
  * Total: 4–8 points only. Each point must represent a meaningful navigation decision, not just fill space.
- WATER-ONLY RULES:
  * Every coordinate must be verifiably on open water when checked on a map — not on the beach, not inland
  * For coastal routes, points must be in the water, not on the shoreline itself
  * For rivers/estuaries, points must be in the navigable channel
  * When rounding headlands, the waypoint goes around the headland in the water, never over land
  * Island circumnavigation: place points at the corners of the island on the water side only
- The "Starting location coordinates" in the user message are your anchor — waypoints must be geographically near those coordinates, on the correct body of water.
- For each route, set "launchPoint" to the specific name of the put-in location (e.g. "Seaton Beach Slipway", "Chichester Marina") so users can navigate to it by car.

OTHER RULES:
- The "routes" array MUST have between 5 and 8 objects, spanning beginner to advanced difficulty.
- "difficulty_rating" must be one of: beginner, intermediate, advanced, expert.
- Use real place names. UK locations should reference real UK paddling spots.
- Give genuinely useful, accurate local knowledge.`;


// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch with a timeout. Rejects with a descriptive error if the deadline
 * elapses before the server responds.
 * @param {string} url
 * @param {RequestInit} opts
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, opts, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out. The AI service is taking too long — please try again.'));
    }, timeoutMs);

    // If an external signal is provided, abort our controller when it fires
    if (externalSignal) {
      if (externalSignal.aborted) { clearTimeout(timer); controller.abort(); reject(new Error('cancelled')); return; }
      externalSignal.addEventListener('abort', () => { clearTimeout(timer); controller.abort(); });
    }

    fetch(url, { ...opts, signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          // Distinguish user cancellation from timeout
          if (externalSignal?.aborted) {
            reject(new Error('cancelled'));
          } else {
            reject(new Error('Request timed out. The AI service is taking too long — please try again.'));
          }
        } else {
          reject(err);
        }
      });
  });
}

/**
 * Build a weather context string suitable for injecting into the Claude prompt.
 * Returns an empty string when weather data is unavailable.
 * @param {Object|null} weather — parsed weather from weatherService
 * @returns {string}
 */
function buildWeatherContext(weather) {
  if (!weather) return '';
  const c = weather.current;
  const lines = [
    '\n--- CURRENT WEATHER DATA (use this to assess route safety) ---',
    `Temperature: ${c.temp}°C`,
    `Wind: ${c.windSpeed} knots from ${c.windDirLabel} (${c.windDir}°)`,
    `Condition: ${c.condition.label} (severity: ${c.condition.severity})`,
    `Wave Height: ${c.waveHeight} m`,
    `Precipitation: ${c.precipitation} mm`,
    `Safety Score: ${weather.safetyScore}/100 (${weather.safetyLabel})`,
  ];

  if (weather.weatherWindow) {
    lines.push(`Best Window: ${weather.weatherWindow.label}`);
  }

  if (weather.hourly && weather.hourly.length > 0) {
    lines.push('\nHourly forecast (next hours):');
    weather.hourly.slice(0, 6).forEach((h) => {
      lines.push(
        `  ${h.time}: ${h.temp}°C, wind ${h.windSpeed}kt, precip ${h.precipProb}%, ${h.condition.label}`,
      );
    });
  }

  if (weather.daily && weather.daily.length > 0) {
    lines.push('\nDaily forecast:');
    weather.daily.slice(0, 3).forEach((d) => {
      lines.push(
        `  ${d.date}: ${d.condition.label}, ${d.tempMin}-${d.tempMax}°C, wind max ${d.windMax}kt`,
      );
    });
  }

  lines.push('--- END WEATHER DATA ---\n');
  return lines.join('\n');
}

// ── GPX helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a [[lat, lon], ...] waypoints array to a minimal GPX XML string.
 */
function waypointsToGpx(name, waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return null;
  const pts = waypoints
    .filter(p => Array.isArray(p) && p.length >= 2)
    .map(([lat, lon]) => `    <trkpt lat="${parseFloat(lat).toFixed(6)}" lon="${parseFloat(lon).toFixed(6)}"/>`)
    .join('\n');
  if (!pts) return null;
  return `<gpx version="1.1" creator="Solvaa"><trk><name>${name}</name><trkseg>\n${pts}\n  </trkseg></trk></gpx>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a usable API key is configured.
 * @returns {boolean}
 */
export const hasApiKey = () => true; // key is validated server-side

/**
 * Legacy: Plan a paddle trip from a natural-language prompt (no weather bridge).
 * @param {string} userPrompt
 * @returns {Promise<Object>}
 */
export async function planPaddle(userPrompt) {
  const response = await fetchWithTimeout(`${BASE_URL}/api/planning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userPrompt }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Planning API error ${response.status}`);
  }
  return response.json();
}

/**
 * Enhanced: Plan three distinct route options with integrated weather analysis.
 *
 * @param {Object} opts
 * @param {string}  opts.prompt        — free-text trip description
 * @param {number}  [opts.lat]         — latitude for weather lookup (optional)
 * @param {number}  [opts.lon]         — longitude for weather lookup (optional)
 * @param {string}  [opts.date]        — requested trip date (ISO string, optional)
 * @param {number}  [opts.durationHrs] — requested paddle duration in hours (optional)
 * @param {string}  [opts.transport]   — "car" | "public_transport" (optional)
 * @param {string[]} [opts.interests]  — e.g. ["coffee","pub","swim"] (optional)
 * @param {Object}  [opts.location]    — { lat, lng } coordinates for the trip (optional)
 * @returns {Promise<Object>} — plan object with exactly 3 routes
 */
export async function planPaddleWithWeather({
  prompt,
  lat,
  lon,
  date,
  durationHrs,
  transport,
  interests,
  location,
  signal,
} = {}) {
  // Resolve coordinates — prefer explicit location, fall back to lat/lon
  const resolvedLat = location?.lat != null ? location.lat : lat;
  const resolvedLon = location?.lng != null ? location.lng : lon;

  // ── 1. Fetch weather context (best-effort — don't fail if unavailable) ────
  let weather = null;
  if (resolvedLat != null && resolvedLon != null) {
    try {
      weather = await getWeatherWithCache(resolvedLat, resolvedLon);
    } catch {
      // Weather unavailable — continue without it
    }
  }

  const weatherCtx = buildWeatherContext(weather);

  // ── 2. Build enriched user message ────────────────────────────────────────
  const parts = [prompt];

  // Temporal context — date and duration
  if (date) {
    const dateStr = typeof date === 'string' ? date : new Date(date).toLocaleDateString();
    parts.push(`\nTrip date: ${dateStr}`);
  }
  if (durationHrs) {
    const durationLabel = durationHrs === 1 ? '1 hour' : `${durationHrs} hours`;
    parts.push(`Desired paddle duration: approximately ${durationLabel}`);
  }

  // Geographic context — coordinates
  if (resolvedLat != null && resolvedLon != null) {
    parts.push(`Starting location coordinates: ${resolvedLat.toFixed(4)}, ${resolvedLon.toFixed(4)}`);
  }

  // Build contextual summary line for the AI
  const contextParts = [];
  if (date) {
    const dateStr = typeof date === 'string' ? date : new Date(date).toLocaleDateString();
    contextParts.push(dateStr);
  }
  if (durationHrs) {
    contextParts.push(`approximately ${durationHrs === 1 ? '1 hour' : `${durationHrs} hours`}`);
  }
  if (resolvedLat != null && resolvedLon != null) {
    contextParts.push(`near coordinates ${resolvedLat.toFixed(4)}, ${resolvedLon.toFixed(4)}`);
  }
  if (contextParts.length > 0) {
    parts.push(`\nPlan a kayak trip for ${contextParts.join(' lasting ')}.`);
  }

  if (transport) parts.push(`Transport: ${transport}`);
  if (interests && interests.length > 0) {
    parts.push(`Interested in stops for: ${interests.join(', ')}`);
  }
  if (weatherCtx) parts.push(weatherCtx);

  const userMessage = parts.join('\n');

  // ── 3. Call backend planning API (avoids CORS hitting Anthropic directly) ───
  const response = await fetchWithTimeout(`${BASE_URL}/api/planning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt: SYSTEM_PROMPT_THREE_ROUTES, userMessage }),
  }, REQUEST_TIMEOUT_MS, signal);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Planning API error ${response.status}`);
  }
  const plan = await response.json();

  // ── 4. Validate route count — pad or trim to exactly 3 ───────────────────
  if (!Array.isArray(plan.routes)) {
    plan.routes = [];
  }

  // Ensure every route has required fields with safe defaults
  plan.routes = plan.routes.map((r, i) => ({
    name: r.name || `Route ${i + 1}`,
    description: r.description || '',
    difficulty_rating: r.difficulty_rating || 'intermediate',
    estimated_duration: r.estimated_duration || r.durationHours || 2,
    waypoints: Array.isArray(r.waypoints)
      ? (waypointsToGpx(r.name || `Route ${i + 1}`, r.waypoints) ?? r.waypoints)
      : (r.waypoints || []),
    weather_impact_summary: r.weather_impact_summary || 'No weather data available',
    distanceKm: r.distanceKm || 0,
    terrain: r.terrain || 'coastal',
    difficulty: r.difficulty || r.difficulty_rating || 'moderate',
    why: r.why || r.description || '',
    travelFromBase: r.travelFromBase || '',
    travelTimeMin: r.travelTimeMin || 0,
    highlights: r.highlights || [],
    launchPoint: r.launchPoint || '',
    bestConditions: r.bestConditions || '',
    gpxUrl: r.gpx_url || null,
    // Keep original estimated_duration also as durationHours for backward compat
    durationHours: r.estimated_duration || r.durationHours || 2,
  }));

  // Trim to 8 or pad with placeholder copies if Claude returned fewer
  while (plan.routes.length < 5) {
    const base = plan.routes[0] || {
      name: 'Alternative Route',
      description: 'Suggested alternative',
      difficulty_rating: 'intermediate',
      estimated_duration: 2,
      waypoints: [],
      weather_impact_summary: 'No weather data available',
      distanceKm: 0,
      terrain: 'coastal',
      difficulty: 'moderate',
      why: '',
      travelFromBase: '',
      travelTimeMin: 0,
      highlights: [],
      launchPoint: '',
      bestConditions: '',
      durationHours: 2,
    };
    plan.routes.push({ ...base, name: `Alternative ${plan.routes.length + 1}` });
  }
  plan.routes = plan.routes.slice(0, 8);

  // Attach fetched weather data so the UI can display it
  plan._weather = weather;

  return plan;
}

/**
 * Ask a safety/weather question about the current routes and conditions.
 * @param {Object} opts
 * @param {string}  opts.question  — free-text question from the user
 * @param {Object}  [opts.weather] — current weather object (current conditions)
 * @param {Array}   [opts.routes]  — array of route objects in the plan
 * @returns {Promise<string>} — concise answer text
 */
export async function askSafety({ question, weather, routes } = {}) {
  const response = await fetchWithTimeout(`${BASE_URL}/api/planning/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, weather: weather?.current || null, routes }),
  }, 30_000);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Ask API error ${response.status}`);
  }
  const { answer } = await response.json();
  return answer;
}

/**
 * Ask a follow-up question about previously generated local knowledge.
 * @param {Object} opts
 * @param {string}  opts.question       — the user's question
 * @param {Object}  opts.localKnowledge — the already-generated knowledge object
 * @param {Object}  [opts.route]        — route context
 * @returns {Promise<string>} plain-text answer
 */
export async function askLocalKnowledge({ question, localKnowledge, route } = {}) {
  const response = await fetchWithTimeout(`${BASE_URL}/api/planning/local-knowledge/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, localKnowledge, route }),
  }, 30_000);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Ask API error ${response.status}`);
  }
  const { answer } = await response.json();
  return answer;
}

/**
 * Generate local paddling knowledge for a saved route.
 * Returns tides, currents, wind patterns, hazards, emergency contacts etc.
 */
export async function generateLocalKnowledge(route) {
  const response = await fetchWithTimeout(`${BASE_URL}/api/planning/local-knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route }),
  }, 90_000);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Local knowledge API error ${response.status}`);
  }
  return response.json();
}

/**
 * Refine a single existing route based on free-text instructions.
 * Returns a single updated route object in the same shape.
 */
export async function refineRoute(existingRoute, instruction) {
  const systemPrompt = `You are modifying a single kayak route based on user feedback.
Return ONLY a valid JSON object (no markdown, no backticks, no preamble) with the same structure as the provided route, with the requested changes applied.
Preserve all fields that don't need changing. Ensure waypoints trace real navigable water — never cross dry land. Include 8-15 waypoints on water.`;

  const userMessage = `Existing route:\n${JSON.stringify(existingRoute, null, 2)}\n\nUser request: ${instruction}\n\nReturn the complete updated route object.`;

  const response = await fetchWithTimeout(`${BASE_URL}/api/planning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userMessage }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Planning API error ${response.status}`);
  }
  return response.json();
}
