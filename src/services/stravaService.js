import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

const CLIENT_ID     = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.EXPO_PUBLIC_STRAVA_CLIENT_SECRET || '';

const TOKENS_KEY  = 'STRAVA_TOKENS';
const ATHLETE_KEY = 'STRAVA_ATHLETE';

const MOBILE_REDIRECT = 'paddle://auth/strava';
// Web redirect must also be registered in your Strava API settings at
// https://www.strava.com/settings/api → Authorization Callback Domain
const WEB_REDIRECT = typeof window !== 'undefined' ? window.location.origin : '';

const REDIRECT_URI = Platform.OS === 'web' ? WEB_REDIRECT : MOBILE_REDIRECT;
const SCOPE = 'read,activity:read';

// ── Public helpers ─────────────────────────────────────────────────────────────

export function isStravaConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export async function getStravaTokens() {
  try {
    const raw = await AsyncStorage.getItem(TOKENS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function disconnectStrava() {
  await AsyncStorage.multiRemove([TOKENS_KEY, ATHLETE_KEY]);
}

// ── OAuth flow ─────────────────────────────────────────────────────────────────

function buildAuthURL() {
  const params = new URLSearchParams({
    client_id:        CLIENT_ID,
    response_type:    'code',
    redirect_uri:     REDIRECT_URI,
    approval_prompt:  'auto',
    scope:            SCOPE,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed: ${text}`);
  }
  return res.json();
}

async function saveTokenData(data) {
  await AsyncStorage.setItem(TOKENS_KEY, JSON.stringify({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    data.expires_at,
  }));
  if (data.athlete) {
    await AsyncStorage.setItem(ATHLETE_KEY, JSON.stringify(data.athlete));
  }
  return data.athlete ?? null;
}

/**
 * Mobile + web entry point.
 * Mobile:  opens an in-app browser, waits for the deep-link callback, exchanges the code.
 * Web:     redirects the page to Strava; call handleStravaWebCallback() on return.
 */
export async function connectStrava() {
  if (!isStravaConfigured()) throw new Error('Strava client credentials not set in .env');

  const authURL = buildAuthURL();

  if (Platform.OS !== 'web') {
    const result = await WebBrowser.openAuthSessionAsync(authURL, MOBILE_REDIRECT);
    if (result.type !== 'success') throw new Error('Strava auth was cancelled');

    const params = new URLSearchParams(result.url.split('?')[1] || '');
    const code   = params.get('code');
    if (!code) throw new Error('No code returned from Strava');

    const data = await exchangeCode(code);
    return saveTokenData(data);
  } else {
    // Web: full-page redirect to Strava; HomeScreen handles the return via handleStravaWebCallback
    window.location.href = authURL;
    return null; // page will reload
  }
}

/**
 * Call this on web when the page loads and window.location has ?code=&scope= params.
 * Returns the athlete object.
 */
export async function handleStravaWebCallback(code) {
  const data = await exchangeCode(code);
  return saveTokenData(data);
}

// ── Token management ───────────────────────────────────────────────────────────

async function refreshTokens(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Strava token refresh failed');
  return res.json();
}

export async function getValidAccessToken() {
  const tokens = await getStravaTokens();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at > now + 60) return tokens.access_token;

  const refreshed = await refreshTokens(tokens.refresh_token);
  await AsyncStorage.setItem(TOKENS_KEY, JSON.stringify({
    access_token:  refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at:    refreshed.expires_at,
  }));
  return refreshed.access_token;
}

// ── Strava API calls ───────────────────────────────────────────────────────────

export async function getStravaAthlete() {
  try {
    // Return cached athlete first, then refresh in background
    const cached = await AsyncStorage.getItem(ATHLETE_KEY);
    if (cached) return JSON.parse(cached);

    const token = await getValidAccessToken();
    if (!token) return null;

    const res = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const athlete = await res.json();
    await AsyncStorage.setItem(ATHLETE_KEY, JSON.stringify(athlete));
    return athlete;
  } catch { return null; }
}

export async function fetchStravaActivities(perPage = 30) {
  const token = await getValidAccessToken();
  if (!token) return [];
  try {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

// ── Skill level reference (used for safety constraints) ──────────────────────

export const SKILL_LEVELS = {
  BEGINNER: {
    key: 'beginner', label: 'Beginner',
    description: 'New to kayaking, calm water only',
    maxWindKnots: 10, maxWaveM: 0.3, maxDistKm: 8,
    preferredRouteTypes: ['flat_water', 'sheltered_bay'],
  },
  INTERMEDIATE: {
    key: 'intermediate', label: 'Intermediate',
    description: 'Comfortable in moderate conditions',
    maxWindKnots: 18, maxWaveM: 0.8, maxDistKm: 20,
    preferredRouteTypes: ['coastal', 'river', 'lake_crossing'],
  },
  ADVANCED: {
    key: 'advanced', label: 'Advanced',
    description: 'Experienced in challenging conditions',
    maxWindKnots: 25, maxWaveM: 1.5, maxDistKm: 40,
    preferredRouteTypes: ['open_water', 'coastal', 'sea_kayak'],
  },
  EXPERT: {
    key: 'expert', label: 'Expert',
    description: 'Elite paddler, all conditions',
    maxWindKnots: 35, maxWaveM: 3, maxDistKm: 80,
    preferredRouteTypes: ['open_water', 'expedition', 'surf_zone'],
  },
};

// ── Effort levels for manual entry ───────────────────────────────────────────

export const EFFORT_LEVELS = [
  { key: 'easy',   label: 'Easy',   description: 'Relaxed pace, could go further' },
  { key: 'medium', label: 'Medium', description: 'Steady effort, comfortable' },
  { key: 'hard',   label: 'Hard',   description: 'Pushing limits, exhausting' },
];

// ── Activity-based proficiency ───────────────────────────────────────────────
// Instead of static labels, proficiency is defined by concrete paddle metrics.
// This gives Claude AI a real baseline of what the user has accomplished.

/**
 * Build a proficiency object from a single paddle's metrics.
 * @param {object} opts
 * @param {number} opts.distanceKm  — distance paddled in km
 * @param {number} opts.durationHrs — time taken in hours
 * @param {string} opts.effort      — 'easy' | 'medium' | 'hard'
 * @param {string} opts.source      — 'manual' | 'strava'
 * @returns {object} proficiency descriptor with safety constraints
 */
export function buildProficiency({ distanceKm, durationHrs, effort, source }) {
  const speedKmh = durationHrs > 0 ? distanceKm / durationHrs : 0;
  const level = inferLevelFromMetrics(distanceKm, durationHrs, effort);
  const constraints = SKILL_LEVELS[level.toUpperCase()] || SKILL_LEVELS.BEGINNER;

  return {
    ...constraints,
    source,
    distanceKm:  Math.round(distanceKm * 10) / 10,
    durationHrs: Math.round(durationHrs * 10) / 10,
    effort,
    speedKmh:    Math.round(speedKmh * 10) / 10,
    level:       level,
    label:       `${Math.round(distanceKm)} km in ${formatDuration(durationHrs)} at ${effort} effort`,
  };
}

/**
 * Infer a safety-gate level from concrete paddle metrics.
 * This maps real numbers to the constraint tier for route generation.
 */
export function inferLevelFromMetrics(distanceKm, durationHrs, effort) {
  let score = 0;

  // Distance scoring
  if (distanceKm >= 40)      score += 4;
  else if (distanceKm >= 20) score += 3;
  else if (distanceKm >= 10) score += 2;
  else if (distanceKm >= 5)  score += 1;

  // Duration scoring — longer paddles show endurance
  if (durationHrs >= 6)      score += 3;
  else if (durationHrs >= 3) score += 2;
  else if (durationHrs >= 1) score += 1;

  // Effort adjustment — easy effort at long distances = higher skill
  if (effort === 'easy'   && distanceKm >= 10) score += 1;
  if (effort === 'hard'   && distanceKm < 8)   score -= 1;

  if (score >= 7) return 'expert';
  if (score >= 5) return 'advanced';
  if (score >= 2) return 'intermediate';
  return 'beginner';
}

function formatDuration(hrs) {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Strava-based proficiency ─────────────────────────────────────────────────

export const PADDLE_TYPES = ['Kayaking', 'Canoeing', 'Rowing', 'StandUpPaddling', 'Surfing', 'Kayak'];

/**
 * Analyse Strava activities and build a proficiency from the best paddle.
 * Returns { proficiency, activities, bestActivity } or null if no paddle data.
 */
export function analyseStravaActivities(activities) {
  const paddling = activities.filter(a => PADDLE_TYPES.includes(a.type));
  if (paddling.length === 0) return null;

  // Find the "best" activity — longest distance as primary sort
  const sorted = [...paddling].sort((a, b) => b.distance - a.distance);
  const best = sorted[0];

  const distanceKm  = best.distance / 1000;
  const durationHrs = best.moving_time / 3600;

  // Infer effort from avg speed relative to the activity
  const speedKmh = durationHrs > 0 ? distanceKm / durationHrs : 0;
  let effort = 'medium';
  if (speedKmh >= 8)  effort = 'hard';
  if (speedKmh <= 4)  effort = 'easy';

  const proficiency = buildProficiency({
    distanceKm,
    durationHrs,
    effort,
    source: 'strava',
  });

  // Enrich with aggregate stats
  const totalKm   = paddling.reduce((s, a) => s + a.distance / 1000, 0);
  const avgDistKm = totalKm / paddling.length;
  proficiency.stravaStats = {
    totalActivities: paddling.length,
    totalKm:         Math.round(totalKm * 10) / 10,
    avgDistKm:       Math.round(avgDistKm * 10) / 10,
    longestKm:       Math.round(distanceKm * 10) / 10,
    bestActivityName: best.name,
    bestActivityDate: best.start_date,
  };

  return { proficiency, activities: paddling, bestActivity: best };
}

/**
 * Legacy inferSkillFromStrava — kept for backward compatibility.
 * Returns a SKILL_LEVELS entry.
 */
export function inferSkillFromStrava(activities) {
  const result = analyseStravaActivities(activities);
  if (!result) return SKILL_LEVELS.BEGINNER;
  const level = result.proficiency.level.toUpperCase();
  return SKILL_LEVELS[level] || SKILL_LEVELS.BEGINNER;
}

/**
 * Format a proficiency object into a human-readable string for AI prompts.
 */
export function formatProficiencyForPrompt(proficiency) {
  if (!proficiency) return 'No paddling experience provided';

  const parts = [`${proficiency.distanceKm} km in ${formatDuration(proficiency.durationHrs)}`];
  parts.push(`effort: ${proficiency.effort}`);
  parts.push(`speed: ~${proficiency.speedKmh} km/h`);
  parts.push(`level: ${proficiency.level}`);
  parts.push(`max safe distance: ${proficiency.maxDistKm} km/day`);
  parts.push(`max safe wind: ${proficiency.maxWindKnots} knots`);

  if (proficiency.source === 'strava' && proficiency.stravaStats) {
    parts.push(`(based on ${proficiency.stravaStats.totalActivities} Strava activities, best: ${proficiency.stravaStats.bestActivityName})`);
  } else {
    parts.push('(self-reported)');
  }

  return parts.join(', ');
}
