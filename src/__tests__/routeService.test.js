/**
 * Tests for routeService — route generation logic.
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

const { generateRoutes, assessRealTimeConditions } = require('../services/routeService');

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
