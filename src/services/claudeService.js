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
 *   waypoints:             string   — GPX XML string (<gpx>…</gpx>)
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

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY || '';

/** Default request timeout in ms (30 seconds). */
const REQUEST_TIMEOUT_MS = 30000;

/** Maximum number of retries on timeout or malformed JSON. */
const MAX_RETRIES = 2;

// ── Skill-level description block used inside the system prompt ──────────────
const SKILL_LEVEL_CONTEXT = Object.values(SKILL_LEVELS)
  .map(
    (s) =>
      `- ${s.key}: ${s.description} (max wind ${s.maxWindKnots} kt, max wave ${s.maxWaveM} m, max distance ${s.maxDistKm} km)`,
  )
  .join('\n');

// ── System prompt for three-route weather-aware planning ─────────────────────
const SYSTEM_PROMPT_THREE_ROUTES = `You are a kayaking trip planner assistant built into the Paddle app.

When a user describes a paddle they want to do you MUST respond with a JSON object containing EXACTLY three distinct route options. Each route should represent a different style:
1. **Scenic** — prioritises beautiful scenery, wildlife, peaceful water
2. **Fast / Direct** — most efficient route, shorter distance, minimal detours
3. **Coastal / Adventure** — more exposed water, island hops, or challenging coastline

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
      "waypoints": "<gpx xmlns=\\"http://www.topografix.com/GPX/1/1\\"><trk><name>Route name</name><trkseg><trkpt lat=\\"...\\\" lon=\\"...\\\" /><trkpt ... /></trkseg></trk></gpx>",
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

IMPORTANT:
- The "routes" array MUST have exactly 3 objects.
- "waypoints" must be a valid GPX XML string with realistic lat/lon coordinates that trace the actual route path. Include at least 5 trackpoints per route for good map fidelity.
- "difficulty_rating" must be one of: beginner, intermediate, advanced, expert.
- Use real place names. UK locations should reference real UK paddling spots.
- If they mention Axminster, suggest River Axe estuary, Lyme Bay, Seaton.
- If London with a car, suggest Chichester Harbour, Norfolk Broads, River Wye, Lyme Regis.
- If Bristol, suggest Pembrokeshire, Gower Peninsula, River Wye.
- Give genuinely useful, accurate local knowledge.`;

// ── Legacy system prompt (unchanged) ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are a kayaking trip planner assistant built into the Paddle app.

When a user describes a paddle they want to do, extract and respond with a structured JSON plan. Parse natural language like:
- Location (explicit or implied)
- Duration (hours, days, weekend, week)
- Trip type (day paddle, multi-day, camping)
- Access (own transport, car, public transport)
- Skill level if mentioned
- Any preferences (coastal, river, lake, sheltered, challenging)

Respond ONLY with a valid JSON object (no markdown, no backticks, no preamble) in this exact structure:
{
  "understood": "One sentence confirming what you understood",
  "location": {
    "base": "City/town they are in or near",
    "searchRadius": "how far they can travel in km as a number",
    "transport": "own car | public transport | unknown"
  },
  "trip": {
    "type": "day_paddle | weekend | week | multi_day",
    "durationHours": number or null,
    "durationDays": number or null,
    "paddlingHoursPerDay": number
  },
  "conditions": {
    "skillLevel": "beginner | intermediate | advanced | unknown",
    "terrainPreference": "coastal | river | lake | any",
    "sheltered": true or false
  },
  "routes": [
    {
      "name": "Route name",
      "location": "Specific place name",
      "distanceKm": number,
      "durationHours": number,
      "terrain": "coastal | river | lake | estuary",
      "difficulty": "easy | moderate | challenging",
      "why": "One sentence why this suits them",
      "travelFromBase": "How to get there",
      "travelTimeMin": number,
      "highlights": ["highlight 1", "highlight 2"],
      "launchPoint": "Specific beach/slipway/put-in name",
      "bestConditions": "Wind/tide advice specific to this spot"
    }
  ],
  "campsites": [
    {
      "name": "Campsite name",
      "nearRoute": "Route name it is near",
      "distanceFromWaterKm": number,
      "type": "beach | formal | wild",
      "notes": "Brief useful note"
    }
  ],
  "weatherNote": "General seasonal weather note for the area and time of year",
  "packingHighlights": ["item 1", "item 2", "item 3", "item 4", "item 5"],
  "safetyNote": "One specific safety note relevant to these routes"
}

Be specific with real place names. If in the UK, suggest real UK paddling spots.
If they mention Axminster, suggest the River Axe estuary, Lyme Bay, Seaton.
If they mention London with a car, suggest Chichester Harbour, Norfolk Broads, River Wye, Lyme Regis.
If Bristol, suggest Pembrokeshire, Gower Peninsula, River Wye.
Give genuinely useful, accurate local knowledge.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch with a timeout. Rejects with a descriptive error if the deadline
 * elapses before the server responds.
 * @param {string} url
 * @param {RequestInit} opts
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, opts, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out. The AI service is taking too long — please try again.'));
    }, timeoutMs);

    fetch(url, { ...opts, signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          reject(new Error('Request timed out. The AI service is taking too long — please try again.'));
        } else {
          reject(err);
        }
      });
  });
}

/**
 * Strip markdown fences and leading/trailing whitespace, then parse JSON.
 * Throws a descriptive error when the text is not valid JSON.
 * @param {string} raw
 * @returns {Object}
 */
function safeParseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('MALFORMED_JSON');
  }
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

// ── Core API call with retry ─────────────────────────────────────────────────

/**
 * Calls the Claude messages API and returns the parsed JSON response.
 * Retries up to MAX_RETRIES times on timeout or malformed JSON.
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {number} maxTokens
 * @returns {Promise<Object>}
 */
async function callClaudeWithRetry(systemPrompt, userContent, maxTokens = 2500) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      return safeParseJSON(text);
    } catch (e) {
      lastError = e;
      // Only retry on timeout or malformed JSON
      const isRetryable =
        e.message === 'MALFORMED_JSON' ||
        e.message.includes('timed out');
      if (!isRetryable || attempt === MAX_RETRIES) break;
      // Brief back-off before retrying
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  // Provide a friendly message for the final error
  if (lastError?.message === 'MALFORMED_JSON') {
    throw new Error('Could not parse trip plan. The AI returned an unexpected format — please try again.');
  }
  throw lastError;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a usable API key is configured.
 * @returns {boolean}
 */
export const hasApiKey = () =>
  !!CLAUDE_API_KEY && CLAUDE_API_KEY !== 'sk-ant-your-key-here';

/**
 * Legacy: Plan a paddle trip from a natural-language prompt (no weather bridge).
 * @param {string} userPrompt
 * @returns {Promise<Object>}
 */
export async function planPaddle(userPrompt) {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'sk-ant-your-key-here') {
    throw new Error('CLAUDE_API_KEY not set. Add EXPO_PUBLIC_CLAUDE_API_KEY to your .env file.');
  }
  return callClaudeWithRetry(SYSTEM_PROMPT, userPrompt, 1500);
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
} = {}) {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'sk-ant-your-key-here') {
    throw new Error('CLAUDE_API_KEY not set. Add EXPO_PUBLIC_CLAUDE_API_KEY to your .env file.');
  }

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

  // ── 3. Call Claude with retry ─────────────────────────────────────────────
  const plan = await callClaudeWithRetry(SYSTEM_PROMPT_THREE_ROUTES, userMessage, 3000);

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
    waypoints: r.waypoints || '',
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
    // Keep original estimated_duration also as durationHours for backward compat
    durationHours: r.estimated_duration || r.durationHours || 2,
  }));

  // Trim to 3 or pad with placeholder copies if Claude returned fewer
  while (plan.routes.length < 3) {
    const base = plan.routes[0] || {
      name: 'Alternative Route',
      description: 'Suggested alternative',
      difficulty_rating: 'intermediate',
      estimated_duration: 2,
      waypoints: '',
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
  plan.routes = plan.routes.slice(0, 3);

  // Attach fetched weather data so the UI can display it
  plan._weather = weather;

  return plan;
}
