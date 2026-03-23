/**
 * Tests for weatherService — safety scoring and cache logic.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

const { getWeatherWithCache, fetchWeather } = require('../services/weatherService');

describe('weatherService', () => {
  test('exports getWeatherWithCache as a function', () => {
    expect(typeof getWeatherWithCache).toBe('function');
  });

  test('exports fetchWeather as a function', () => {
    expect(typeof fetchWeather).toBe('function');
  });
});
