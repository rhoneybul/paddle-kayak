/**
 * Tests for routeService — route generation logic and maritime-first routing.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const {
  generateRoutes,
  assessRealTimeConditions,
  haversineDistanceKm,
  validateMaritimeRoute,
  normaliseWaypointCoords,
  densifyMaritimeRoute,
  getRouteLaunchPoint,
  buildNavigateToStartUrl,
  buildWaterCheckQuery,
  isPointOnWater,
} = require('../services/routeService');

const baseWeather = {
  current: {
    windSpeed: 10,
    waveHeight: 0.3,
    condition: { label: 'Partly Cloudy', severity: 'none' },
    windDirLabel: 'SW',
    temp: 15,
    precipitation: 0,
    weatherCode: 2,
  },
  hourly: [],
  daily: [],
  safetyScore: 82,
  safetyLabel: 'Excellent',
  safetyColor: '#3a6a4a',
  weatherWindow: { label: 'Best: 9:00 AM', color: '#3a6a4a' },
};

const skillBeginner = {
  key: 'beginner',
  label: 'Beginner',
  maxWindKnots: 10,
  maxWaveM: 0.3,
  maxDistKm: 8,
  preferredRouteTypes: ['flat_water', 'sheltered_bay'],
};

const skillAdvanced = {
  key: 'advanced',
  label: 'Advanced',
  maxWindKnots: 25,
  maxWaveM: 1.5,
  maxDistKm: 40,
  preferredRouteTypes: ['open_water', 'coastal', 'sea_kayak'],
};

describe('generateRoutes', () => {
  test('returns an array of routes', () => {
    const routes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: { label: 'Test', coords: { lat: 50.7, lon: -3.0 } },
      durationDays: 1,
    });
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  test('each route has required fields', () => {
    const routes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: { label: 'Test', coords: { lat: 50.7, lon: -3.0 } },
      durationDays: 1,
    });
    routes.forEach(r => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('distanceKm');
      expect(r).toHaveProperty('durationHours');
      expect(r).toHaveProperty('difficulty');
      expect(r).toHaveProperty('suitability');
      expect(r).toHaveProperty('waypoints');
      expect(r).toHaveProperty('tips');
    });
  });

  test('beginner routes have shorter distances', () => {
    const begRoutes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: null,
      durationDays: 1,
    });
    const advRoutes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillAdvanced,
      weather: baseWeather,
      location: null,
      durationDays: 1,
    });
    const begAvg = begRoutes.reduce((s, r) => s + r.distanceKm, 0) / begRoutes.length;
    const advAvg = advRoutes.reduce((s, r) => s + r.distanceKm, 0) / advRoutes.length;
    expect(begAvg).toBeLessThan(advAvg);
  });

  test('suitability score is 0-100', () => {
    const routes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: null,
      durationDays: 1,
    });
    routes.forEach(r => {
      expect(r.suitability).toBeGreaterThanOrEqual(0);
      expect(r.suitability).toBeLessThanOrEqual(100);
    });
  });

  test('routes include maritime validation metadata', () => {
    const routes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: { lat: 50.7, lon: -3.0 },
      durationDays: 1,
    });
    routes.forEach(r => {
      expect(r).toHaveProperty('maritimeValidation');
      expect(r.maritimeValidation).toHaveProperty('valid');
      expect(r.maritimeValidation).toHaveProperty('warnings');
      expect(r.maritimeValidation).toHaveProperty('totalGeometryKm');
      expect(r.maritimeValidation).toHaveProperty('maxShoreDistanceKm');
      expect(typeof r.maritimeValidation.valid).toBe('boolean');
      expect(Array.isArray(r.maritimeValidation.warnings)).toBe(true);
    });
  });

  test('routes include launch point for navigate-to-start', () => {
    const routes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: { lat: 50.7, lon: -3.0 },
      durationDays: 1,
    });
    routes.forEach(r => {
      expect(r).toHaveProperty('launchPoint');
      expect(r.launchPoint).not.toBeNull();
      expect(r.launchPoint).toHaveProperty('lat');
      expect(r.launchPoint).toHaveProperty('lon');
      expect(r.launchPoint).toHaveProperty('name');
    });
  });

  test('beginner routes have lower maxShoreDistanceKm than advanced', () => {
    const begRoutes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillBeginner,
      weather: baseWeather,
      location: { lat: 50.7, lon: -3.0 },
      durationDays: 1,
    });
    const advRoutes = generateRoutes({
      tripType: { id: 'day_paddle', days: 1 },
      skillLevel: skillAdvanced,
      weather: baseWeather,
      location: { lat: 50.7, lon: -3.0 },
      durationDays: 1,
    });
    const begMax = Math.max(...begRoutes.map(r => r.maritimeValidation.maxShoreDistanceKm));
    const advMax = Math.max(...advRoutes.map(r => r.maritimeValidation.maxShoreDistanceKm));
    expect(begMax).toBeLessThan(advMax);
  });
});

describe('assessRealTimeConditions', () => {
  test('returns assessment object with warnings and recommendations', () => {
    const result = assessRealTimeConditions(
      baseWeather.current,
      { distanceKm: 5, elapsedHours: 1, totalDistanceKm: 10 },
      skillBeginner,
    );
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('recommendations');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
  });
});

// ── Maritime-first routing unit tests ──────────────────────────────────────────

describe('haversineDistanceKm', () => {
  test('returns 0 for identical points', () => {
    expect(haversineDistanceKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  test('calculates approximately correct distance for known pair', () => {
    // London to Paris is ~343 km
    const dist = haversineDistanceKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(360);
  });

  test('returns positive distance for any two different points', () => {
    const dist = haversineDistanceKm(50.7, -3.0, 50.71, -3.01);
    expect(dist).toBeGreaterThan(0);
  });
});

describe('normaliseWaypointCoords', () => {
  test('handles [lat, lon] array format', () => {
    const result = normaliseWaypointCoords([[50.7, -3.0], [50.8, -3.1]]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ lat: 50.7, lon: -3.0, type: 'start' }));
    expect(result[1]).toEqual(expect.objectContaining({ lat: 50.8, lon: -3.1, type: 'finish' }));
  });

  test('handles {lat, lon} object format', () => {
    const result = normaliseWaypointCoords([
      { lat: 50.7, lon: -3.0, name: 'A', type: 'start' },
      { lat: 50.8, lon: -3.1, name: 'B', type: 'finish' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('B');
  });

  test('filters out invalid entries', () => {
    const result = normaliseWaypointCoords([
      [50.7, -3.0],
      'invalid',
      null,
      [NaN, -3.1],
      [50.9, -3.2],
    ]);
    expect(result).toHaveLength(2);
  });

  test('returns empty array for non-array input', () => {
    expect(normaliseWaypointCoords(null)).toEqual([]);
    expect(normaliseWaypointCoords(undefined)).toEqual([]);
    expect(normaliseWaypointCoords('hello')).toEqual([]);
  });

  test('assigns start/finish types based on position', () => {
    const result = normaliseWaypointCoords([[50.7, -3.0], [50.75, -3.05], [50.8, -3.1]]);
    expect(result[0].type).toBe('start');
    expect(result[1].type).toBe('waypoint');
    expect(result[2].type).toBe('finish');
  });
});

describe('validateMaritimeRoute', () => {
  test('returns valid for a reasonable short route', () => {
    const waypoints = [
      { lat: 50.7, lon: -3.0 },
      { lat: 50.705, lon: -3.005 },
      { lat: 50.71, lon: -3.01 },
    ];
    const result = validateMaritimeRoute(waypoints);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.totalDistanceKm).toBeGreaterThan(0);
  });

  test('flags route with large segment jumps', () => {
    const waypoints = [
      { lat: 50.0, lon: -3.0 },
      { lat: 51.0, lon: -2.0 }, // ~130 km jump
    ];
    const result = validateMaritimeRoute(waypoints, { maxSegmentKm: 10 });
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('possible land crossing');
  });

  test('flags significant distance mismatch', () => {
    const waypoints = [
      { lat: 50.7, lon: -3.0 },
      { lat: 50.705, lon: -3.005 },
    ];
    const result = validateMaritimeRoute(waypoints, { declaredDistKm: 100 });
    expect(result.valid).toBe(false);
    expect(result.warnings.some(w => w.includes('differs significantly'))).toBe(true);
  });

  test('returns correct shore distance based on skill', () => {
    const waypoints = [{ lat: 50.7, lon: -3.0 }, { lat: 50.71, lon: -3.01 }];
    const begResult = validateMaritimeRoute(waypoints, { skillKey: 'beginner' });
    const advResult = validateMaritimeRoute(waypoints, { skillKey: 'advanced' });
    expect(begResult.maxShoreDistanceKm).toBe(0.5);
    expect(advResult.maxShoreDistanceKm).toBe(3.0);
  });

  test('handles fewer than 2 waypoints', () => {
    const result = validateMaritimeRoute([{ lat: 50.7, lon: -3.0 }]);
    expect(result.valid).toBe(false);
    expect(result.warnings[0]).toContain('fewer than 2');
  });

  test('handles empty array', () => {
    const result = validateMaritimeRoute([]);
    expect(result.valid).toBe(false);
  });

  test('handles [lat, lon] array format', () => {
    const result = validateMaritimeRoute([[50.7, -3.0], [50.705, -3.005], [50.71, -3.01]]);
    expect(result.valid).toBe(true);
    expect(result.adjustedWaypoints).toHaveLength(3);
  });
});

describe('densifyMaritimeRoute', () => {
  test('does not modify short segments', () => {
    const waypoints = [
      { lat: 50.7, lon: -3.0, name: 'A', type: 'start' },
      { lat: 50.705, lon: -3.005, name: 'B', type: 'finish' },
    ];
    const result = densifyMaritimeRoute(waypoints, 5);
    expect(result).toHaveLength(2);
  });

  test('adds intermediate points for long segments', () => {
    const waypoints = [
      { lat: 50.0, lon: -3.0, name: 'A', type: 'start' },
      { lat: 51.0, lon: -2.0, name: 'B', type: 'finish' },
    ];
    const result = densifyMaritimeRoute(waypoints, 5);
    expect(result.length).toBeGreaterThan(2);
    // First and last should be original points
    expect(result[0].name).toBe('A');
    expect(result[result.length - 1].name).toBe('B');
  });

  test('intermediate points have maritime waypoint type', () => {
    const waypoints = [
      { lat: 50.0, lon: -3.0, name: 'A', type: 'start' },
      { lat: 51.0, lon: -2.0, name: 'B', type: 'finish' },
    ];
    const result = densifyMaritimeRoute(waypoints, 5);
    const intermediates = result.slice(1, -1);
    intermediates.forEach(p => {
      expect(p.type).toBe('waypoint');
      expect(p.name).toContain('Maritime waypoint');
    });
  });

  test('returns same array for single waypoint', () => {
    const waypoints = [{ lat: 50.0, lon: -3.0 }];
    expect(densifyMaritimeRoute(waypoints)).toEqual(waypoints);
  });
});

describe('getRouteLaunchPoint', () => {
  test('returns first waypoint as launch point', () => {
    const route = {
      waypoints: [
        { lat: 50.7, lon: -3.0, name: 'Beach Start', type: 'start' },
        { lat: 50.8, lon: -3.1, name: 'End', type: 'finish' },
      ],
    };
    const lp = getRouteLaunchPoint(route);
    expect(lp).toEqual({ lat: 50.7, lon: -3.0, name: 'Beach Start' });
  });

  test('handles [lat, lon] array format', () => {
    const route = {
      waypoints: [[50.7, -3.0], [50.8, -3.1]],
    };
    const lp = getRouteLaunchPoint(route);
    expect(lp.lat).toBe(50.7);
    expect(lp.lon).toBe(-3.0);
  });

  test('returns null for empty waypoints', () => {
    expect(getRouteLaunchPoint({ waypoints: [] })).toBeNull();
    expect(getRouteLaunchPoint({})).toBeNull();
    expect(getRouteLaunchPoint(null)).toBeNull();
  });
});

describe('buildNavigateToStartUrl', () => {
  test('returns a valid Google Maps URL', () => {
    const url = buildNavigateToStartUrl(50.7, -3.0);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=50.7,-3&travelmode=driving');
  });

  test('includes coordinates in the URL', () => {
    const url = buildNavigateToStartUrl(51.5074, -0.1278);
    expect(url).toContain('51.5074');
    expect(url).toContain('-0.1278');
    expect(url).toContain('travelmode=driving');
  });
});

describe('buildWaterCheckQuery', () => {
  test('returns a valid Overpass QL query string', () => {
    const query = buildWaterCheckQuery(50.7, -3.0, 200);
    expect(query).toContain('natural');
    expect(query).toContain('water');
    expect(query).toContain('coastline');
    expect(query).toContain('waterway');
    expect(query).toContain('50.7');
    expect(query).toContain('-3');
    expect(query).toContain('200');
  });

  test('uses default radius when not provided', () => {
    const query = buildWaterCheckQuery(50.7, -3.0);
    expect(query).toContain('200');
  });
});

describe('isPointOnWater', () => {
  test('returns true on network failure (permissive fallback)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await isPointOnWater(50.7, -3.0);
    expect(result).toBe(true);
  });

  test('returns true when API returns non-ok status (permissive fallback)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const result = await isPointOnWater(50.7, -3.0);
    expect(result).toBe(true);
  });

  test('returns true when water elements are found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elements: [{ tags: { total: 3 } }] }),
    });
    const result = await isPointOnWater(50.7, -3.0);
    expect(result).toBe(true);
  });

  test('returns false when no water elements are found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elements: [{ tags: { total: 0 } }] }),
    });
    const result = await isPointOnWater(50.7, -3.0);
    expect(result).toBe(false);
  });
});
