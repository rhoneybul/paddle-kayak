/**
 * Tests for claudeService.js
 *
 * These tests exercise the helper functions and the public API without making
 * real HTTP calls — all network requests are mocked via jest globals.
 */

/* -------------------------------------------------------------------------- */
/* Mocks — must be defined before importing the module under test.            */
/* -------------------------------------------------------------------------- */

// Mock stravaService to provide SKILL_LEVELS without needing AsyncStorage/Platform
jest.mock('../stravaService', () => ({
  SKILL_LEVELS: {
    BEGINNER: {
      key: 'beginner',
      label: 'Beginner',
      description: 'New to kayaking, calm water only',
      maxWindKnots: 10,
      maxWaveM: 0.3,
      maxDistKm: 8,
      preferredRouteTypes: ['flat_water', 'sheltered_bay'],
    },
    INTERMEDIATE: {
      key: 'intermediate',
      label: 'Intermediate',
      description: 'Comfortable in moderate conditions',
      maxWindKnots: 18,
      maxWaveM: 0.8,
      maxDistKm: 20,
      preferredRouteTypes: ['coastal', 'river', 'lake_crossing'],
    },
    ADVANCED: {
      key: 'advanced',
      label: 'Advanced',
      description: 'Experienced in challenging conditions',
      maxWindKnots: 25,
      maxWaveM: 1.5,
      maxDistKm: 40,
      preferredRouteTypes: ['open_water', 'coastal', 'sea_kayak'],
    },
    EXPERT: {
      key: 'expert',
      label: 'Expert',
      description: 'Elite paddler, all conditions',
      maxWindKnots: 35,
      maxWaveM: 3,
      maxDistKm: 80,
      preferredRouteTypes: ['open_water', 'expedition', 'surf_zone'],
    },
  },
}));

// Mock weatherService
jest.mock('../weatherService', () => ({
  getWeatherWithCache: jest.fn(),
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Build a minimal valid 3-route response that matches the expected schema. */
function buildValidRouteResponse(overrides = {}) {
  const base = {
    understood: 'Test understood statement',
    location: { base: 'Axminster', searchRadius: 50, transport: 'own car', lat: 50.78, lon: -2.99 },
    trip: { type: 'day_paddle', durationHours: 3, durationDays: null, paddlingHoursPerDay: 3 },
    conditions: { skillLevel: 'intermediate', terrainPreference: 'coastal', sheltered: false },
    routes: [
      {
        name: 'Scenic Estuary Loop',
        description: 'A gentle paddle through the estuary',
        difficulty_rating: 'beginner',
        estimated_duration: 2,
        waypoints: '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Scenic</name><trkseg><trkpt lat="50.7" lon="-3.0"/></trkseg></trk></gpx>',
        weather_impact_summary: 'Light winds from the west are favourable.',
        distanceKm: 8,
        terrain: 'estuary',
        why: 'Sheltered and scenic for all levels',
        travelFromBase: 'Drive south 15 min',
        travelTimeMin: 15,
        highlights: ['Wildlife', 'Quiet water'],
        launchPoint: 'Axe Yacht Club',
        bestConditions: 'Neap tide, wind < 10 kt',
      },
      {
        name: 'Fast River Sprint',
        description: 'A direct downstream paddle',
        difficulty_rating: 'intermediate',
        estimated_duration: 1.5,
        waypoints: '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Fast</name><trkseg><trkpt lat="50.71" lon="-3.01"/></trkseg></trk></gpx>',
        weather_impact_summary: 'No weather concerns for river paddle.',
        distanceKm: 6,
        terrain: 'river',
        why: 'Quick and efficient route',
        travelFromBase: '10 min drive',
        travelTimeMin: 10,
        highlights: ['Fast current'],
        launchPoint: 'Town bridge',
        bestConditions: 'Any conditions',
      },
      {
        name: 'Coastal Adventure',
        description: 'An exposed coastal paddle with great views',
        difficulty_rating: 'advanced',
        estimated_duration: 3,
        waypoints: '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Coastal</name><trkseg><trkpt lat="50.72" lon="-2.99"/></trkseg></trk></gpx>',
        weather_impact_summary: 'Watch for afternoon swell increase.',
        distanceKm: 12,
        terrain: 'coastal',
        why: 'Exciting coastline exploration',
        travelFromBase: '20 min drive',
        travelTimeMin: 20,
        highlights: ['Cliffs', 'Sea caves'],
        launchPoint: 'Lyme Regis harbour',
        bestConditions: 'Morning, wind < 15 kt',
      },
    ],
    campsites: [],
    weatherNote: 'Fine weather expected.',
    packingHighlights: ['Sunscreen', 'Water', 'Snacks', 'Phone', 'First aid'],
    safetyNote: 'Check tide tables before departure.',
    ...overrides,
  };
  return base;
}

/** Convenience: create a mock `fetch` Response with JSON body. */
function mockFetchResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** Simulate Claude API response envelope wrapping a JSON text block. */
function claudeEnvelope(jsonObj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(jsonObj) }],
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

// We need to set the env var before the module reads it.
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;

beforeAll(() => {
  process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-test-key-123';
});

afterAll(() => {
  if (ORIGINAL_ENV !== undefined) {
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = ORIGINAL_ENV;
  } else {
    delete process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
  }
});

// Re-require for each describe to pick up env changes — but because of jest.mock
// caching this is safe.
let claudeService;
beforeEach(() => {
  jest.resetModules();
  // Re-set env before re-requiring
  process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-test-key-123';
  claudeService = require('../claudeService');
  // Reset fetch mock
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ── hasApiKey ──────────────────────────────────────────────────────────────── */

describe('hasApiKey', () => {
  test('returns true when a valid key is set', () => {
    expect(claudeService.hasApiKey()).toBe(true);
  });

  test('returns false for the placeholder key', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-your-key-here';
    const mod = require('../claudeService');
    expect(mod.hasApiKey()).toBe(false);
  });

  test('returns false when key is empty', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = '';
    const mod = require('../claudeService');
    expect(mod.hasApiKey()).toBe(false);
  });
});

/* ── planPaddle (legacy) ────────────────────────────────────────────────────── */

describe('planPaddle', () => {
  test('returns parsed JSON from Claude response', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddle('Day paddle in Axminster');
    expect(result).toEqual(expected);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('strips markdown fences before parsing', async () => {
    const expected = buildValidRouteResponse();
    const wrappedText = '```json\n' + JSON.stringify(expected) + '\n```';
    global.fetch = jest.fn(() =>
      mockFetchResponse({ content: [{ type: 'text', text: wrappedText }] }),
    );

    const result = await claudeService.planPaddle('test');
    expect(result.understood).toBe(expected.understood);
  });

  test('throws on non-ok response', async () => {
    global.fetch = jest.fn(() =>
      mockFetchResponse({ error: { message: 'Rate limited' } }, false, 429),
    );

    await expect(claudeService.planPaddle('test')).rejects.toThrow('Rate limited');
  });

  test('retries on malformed JSON then succeeds', async () => {
    const expected = buildValidRouteResponse();
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        // First call returns garbage text
        return mockFetchResponse({ content: [{ type: 'text', text: 'not json {{{{' }] });
      }
      // Second call returns valid JSON
      return mockFetchResponse(claudeEnvelope(expected));
    });

    const result = await claudeService.planPaddle('test');
    expect(result.understood).toBe(expected.understood);
    expect(callCount).toBe(2);
  });

  test('fails after max retries on persistent malformed JSON', async () => {
    global.fetch = jest.fn(() =>
      mockFetchResponse({ content: [{ type: 'text', text: '{invalid' }] }),
    );

    await expect(claudeService.planPaddle('test')).rejects.toThrow(
      /unexpected format/i,
    );
    // 1 initial + 2 retries = 3 calls
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

/* ── planPaddleWithWeather ──────────────────────────────────────────────────── */

describe('planPaddleWithWeather', () => {
  test('returns exactly 3 routes even when Claude returns 3', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({
      prompt: 'Day paddle in Axminster',
    });

    expect(result.routes).toHaveLength(3);
    expect(result.routes[0].name).toBe('Scenic Estuary Loop');
    expect(result.routes[1].name).toBe('Fast River Sprint');
    expect(result.routes[2].name).toBe('Coastal Adventure');
  });

  test('pads routes to 3 when Claude returns fewer', async () => {
    const oneRoute = buildValidRouteResponse({ routes: [buildValidRouteResponse().routes[0]] });
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(oneRoute)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });
    expect(result.routes).toHaveLength(3);
    // The first route should be the original
    expect(result.routes[0].name).toBe('Scenic Estuary Loop');
    // Padded routes should have sequential names
    expect(result.routes[1].name).toBe('Alternative 2');
    expect(result.routes[2].name).toBe('Alternative 3');
  });

  test('trims routes to 3 when Claude returns more', async () => {
    const fourRoutes = buildValidRouteResponse();
    fourRoutes.routes.push({
      ...fourRoutes.routes[0],
      name: 'Extra Route',
    });
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(fourRoutes)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });
    expect(result.routes).toHaveLength(3);
  });

  test('each route contains required fields', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });

    const requiredFields = [
      'name',
      'description',
      'difficulty_rating',
      'estimated_duration',
      'waypoints',
      'weather_impact_summary',
      'distanceKm',
      'terrain',
    ];

    result.routes.forEach((route) => {
      requiredFields.forEach((field) => {
        expect(route).toHaveProperty(field);
      });
    });
  });

  test('difficulty_rating aligns with SKILL_LEVELS keys', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });
    const validRatings = ['beginner', 'intermediate', 'advanced', 'expert'];
    result.routes.forEach((route) => {
      expect(validRatings).toContain(route.difficulty_rating);
    });
  });

  test('GPX waypoints are included as strings', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });
    result.routes.forEach((route) => {
      expect(typeof route.waypoints).toBe('string');
      if (route.waypoints) {
        expect(route.waypoints).toContain('gpx');
      }
    });
  });

  test('fetches weather when lat/lon provided and injects into prompt', async () => {
    const { getWeatherWithCache } = require('../weatherService');
    getWeatherWithCache.mockResolvedValue({
      current: {
        temp: 18,
        windSpeed: 12,
        windDir: 270,
        windDirLabel: 'W',
        precipitation: 0,
        weatherCode: 1,
        condition: { label: 'Partly Cloudy', icon: '⛅', severity: 'none' },
        waveHeight: 0.3,
        timestamp: '2024-07-01T10:00:00Z',
      },
      hourly: [],
      daily: [],
      safetyScore: 85,
      safetyLabel: 'Excellent',
      safetyColor: '#3a6a4a',
      weatherWindow: { label: 'Best: 10:00', color: '#3a6a4a' },
      fetchedAt: Date.now(),
    });

    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({
      prompt: 'Day paddle in Axminster',
      lat: 50.78,
      lon: -2.99,
    });

    expect(getWeatherWithCache).toHaveBeenCalledWith(50.78, -2.99);
    expect(result._weather).not.toBeNull();
    expect(result._weather.safetyScore).toBe(85);

    // Verify the user message sent to Claude contains weather context
    const fetchCall = global.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toContain('CURRENT WEATHER DATA');
    expect(body.messages[0].content).toContain('Wind: 12 knots');
  });

  test('continues without weather when fetch fails', async () => {
    const { getWeatherWithCache } = require('../weatherService');
    getWeatherWithCache.mockRejectedValue(new Error('Network error'));

    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    const result = await claudeService.planPaddleWithWeather({
      prompt: 'test',
      lat: 50.78,
      lon: -2.99,
    });

    // Should still return routes even if weather fails
    expect(result.routes).toHaveLength(3);
    expect(result._weather).toBeNull();
  });

  test('does not fetch weather when lat/lon not provided', async () => {
    const { getWeatherWithCache } = require('../weatherService');
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    await claudeService.planPaddleWithWeather({ prompt: 'test' });
    expect(getWeatherWithCache).not.toHaveBeenCalled();
  });

  test('includes optional parameters in user message', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    await claudeService.planPaddleWithWeather({
      prompt: 'Day paddle',
      date: '2024-07-15',
      durationHrs: 3,
      transport: 'car',
      interests: ['coffee', 'pub'],
    });

    const fetchCall = global.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const userMsg = body.messages[0].content;
    expect(userMsg).toContain('Trip date: 2024-07-15');
    expect(userMsg).toContain('Desired paddle duration: approximately 3 hours');
    expect(userMsg).toContain('Transport: car');
    expect(userMsg).toContain('coffee, pub');
  });

  test('normalises routes with missing fields to have safe defaults', async () => {
    const sparse = buildValidRouteResponse({
      routes: [
        { name: 'Minimal Route' },
        { distanceKm: 5 },
        {},
      ],
    });
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(sparse)));

    const result = await claudeService.planPaddleWithWeather({ prompt: 'test' });

    expect(result.routes[0].name).toBe('Minimal Route');
    expect(result.routes[0].difficulty_rating).toBe('intermediate'); // default
    expect(result.routes[0].estimated_duration).toBe(2); // default
    expect(result.routes[0].waypoints).toBe(''); // default
    expect(result.routes[1].name).toBe('Route 2');
    expect(result.routes[1].distanceKm).toBe(5);
    expect(result.routes[2].name).toBe('Route 3');
  });

  test('throws user-friendly error when API key is missing', async () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = '';
    const mod = require('../claudeService');

    await expect(
      mod.planPaddleWithWeather({ prompt: 'test' }),
    ).rejects.toThrow(/CLAUDE_API_KEY not set/);
  });

  test('system prompt enforces exactly 3 route JSON schema', async () => {
    const expected = buildValidRouteResponse();
    global.fetch = jest.fn(() => mockFetchResponse(claudeEnvelope(expected)));

    await claudeService.planPaddleWithWeather({ prompt: 'test' });

    const fetchCall = global.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    // Verify the system prompt mentions 3 routes
    expect(body.system).toContain('EXACTLY three');
    expect(body.system).toContain('difficulty_rating');
    expect(body.system).toContain('weather_impact_summary');
    expect(body.system).toContain('waypoints');
    expect(body.system).toContain('gpx');
  });
});

/* ── Timeout handling ───────────────────────────────────────────────────────── */

describe('timeout handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects with timeout error when request takes too long', async () => {
    // Mock fetch that never resolves
    global.fetch = jest.fn(
      () => new Promise(() => {}), // intentionally never resolves
    );

    const promise = claudeService.planPaddle('test');

    // Advance time past all retries: 30s + 1s backoff + 30s + 2s backoff + 30s = ~93s
    // Run pending timers multiple times to cover the retry loop
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(35000);
      // Allow microtasks (promise chains) to flush between timer advances
      await Promise.resolve();
    }

    await expect(promise).rejects.toThrow(/timed out/i);
  }, 30000);
});

/* ── Error handling edge cases ──────────────────────────────────────────────── */

describe('error handling', () => {
  test('handles empty content array from API', async () => {
    global.fetch = jest.fn(() =>
      mockFetchResponse({ content: [] }),
    );

    await expect(claudeService.planPaddle('test')).rejects.toThrow(
      /unexpected format/i,
    );
  });

  test('handles non-JSON error response body', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      }),
    );

    await expect(claudeService.planPaddle('test')).rejects.toThrow(/API error 500/);
  });
});
