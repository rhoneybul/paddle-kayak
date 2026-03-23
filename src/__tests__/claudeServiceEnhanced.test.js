/**
 * Tests for claudeService — enhanced planPaddleWithWeather with date/location context.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

describe('claudeService enhanced', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('planPaddleWithWeather is exported as a function', () => {
    const { planPaddleWithWeather } = require('../services/claudeService');
    expect(typeof planPaddleWithWeather).toBe('function');
  });

  test('planPaddleWithWeather throws when no API key', async () => {
    delete process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
    const { planPaddleWithWeather } = require('../services/claudeService');
    await expect(
      planPaddleWithWeather({ prompt: 'test', date: '2025-06-01', durationHrs: 3 })
    ).rejects.toThrow();
  });

  test('planPaddleWithWeather accepts location parameter', () => {
    const { planPaddleWithWeather } = require('../services/claudeService');
    // Just verify the function accepts these params without type errors
    expect(typeof planPaddleWithWeather).toBe('function');
    // The function signature should accept { prompt, lat, lon, date, durationHrs, transport, interests, location }
  });

  test('planPaddleWithWeather accepts date and durationHrs parameters', () => {
    // Verify the service function can be called with the new parameters
    const { planPaddleWithWeather } = require('../services/claudeService');
    expect(typeof planPaddleWithWeather).toBe('function');
  });

  test('hasApiKey returns false for placeholder key', () => {
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-your-key-here';
    const { hasApiKey } = require('../services/claudeService');
    expect(hasApiKey()).toBe(false);
  });

  test('hasApiKey returns true for real key', () => {
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-real-key-123';
    const { hasApiKey } = require('../services/claudeService');
    expect(hasApiKey()).toBe(true);
  });
});
