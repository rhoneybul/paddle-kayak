/**
 * Tests for stravaService — skill inference logic.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

const { inferSkillFromStrava, SKILL_LEVELS } = require('../services/stravaService');

describe('inferSkillFromStrava', () => {
  test('returns BEGINNER for empty activities', () => {
    const result = inferSkillFromStrava([]);
    expect(result.key).toBe('beginner');
  });

  test('returns BEGINNER for few short paddles', () => {
    const activities = [
      { type: 'Kayaking', distance: 3000 },
      { type: 'Kayaking', distance: 2000 },
    ];
    const result = inferSkillFromStrava(activities);
    expect(result.key).toBe('beginner');
  });

  test('returns INTERMEDIATE for moderate paddling', () => {
    const activities = Array.from({ length: 8 }, (_, i) => ({
      type: 'Kayaking',
      distance: 12000 + i * 1000, // 12-19 km each
    }));
    const result = inferSkillFromStrava(activities);
    expect(['intermediate', 'advanced']).toContain(result.key);
  });

  test('returns EXPERT for extensive paddling', () => {
    const activities = Array.from({ length: 55 }, (_, i) => ({
      type: 'Kayaking',
      distance: 25000 + i * 500, // 25+ km each
    }));
    activities.push({ type: 'Kayaking', distance: 45000 }); // one 45km paddle
    const result = inferSkillFromStrava(activities);
    expect(result.key).toBe('expert');
  });

  test('ignores non-paddle activities', () => {
    const activities = [
      { type: 'Run', distance: 42000 },
      { type: 'Ride', distance: 100000 },
      { type: 'Swim', distance: 5000 },
    ];
    const result = inferSkillFromStrava(activities);
    expect(result.key).toBe('beginner');
  });

  test('includes Kayak activity type (distinct from Kayaking)', () => {
    const activities = [
      { type: 'Kayak', distance: 15000, moving_time: 7200, name: 'River Kayak', start_date: '2025-06-15T10:00:00Z' },
    ];
    const result = inferSkillFromStrava(activities);
    expect(result.key).not.toBe('beginner');
  });

  test('SKILL_LEVELS has all expected levels', () => {
    expect(SKILL_LEVELS).toHaveProperty('BEGINNER');
    expect(SKILL_LEVELS).toHaveProperty('INTERMEDIATE');
    expect(SKILL_LEVELS).toHaveProperty('ADVANCED');
    expect(SKILL_LEVELS).toHaveProperty('EXPERT');
  });

  test('each skill level has required fields', () => {
    Object.values(SKILL_LEVELS).forEach(level => {
      expect(level).toHaveProperty('key');
      expect(level).toHaveProperty('label');
      expect(level).toHaveProperty('maxWindKnots');
      expect(level).toHaveProperty('maxWaveM');
      expect(level).toHaveProperty('maxDistKm');
      expect(level).toHaveProperty('preferredRouteTypes');
    });
  });
});
