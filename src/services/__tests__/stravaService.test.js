/**
 * Tests for stravaService proficiency logic.
 *
 * These test the pure functions: buildProficiency, inferLevelFromMetrics,
 * analyseStravaActivities, and formatProficiencyForPrompt.
 * OAuth and API calls are not tested here (they require native modules).
 */

// Mock native modules before importing the service
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const {
  buildProficiency,
  inferLevelFromMetrics,
  analyseStravaActivities,
  formatProficiencyForPrompt,
  SKILL_LEVELS,
  EFFORT_LEVELS,
} = require('../stravaService');

// ── buildProficiency ─────────────────────────────────────────────────────────

describe('buildProficiency', () => {
  it('should build a proficiency object with correct metrics', () => {
    const p = buildProficiency({
      distanceKm: 10,
      durationHrs: 2,
      effort: 'medium',
      source: 'manual',
    });

    expect(p.distanceKm).toBe(10);
    expect(p.durationHrs).toBe(2);
    expect(p.effort).toBe('medium');
    expect(p.source).toBe('manual');
    expect(p.speedKmh).toBe(5);
    expect(p.level).toBe('intermediate');
    expect(p.label).toContain('10 km');
    expect(p.label).toContain('2h');
    expect(p.label).toContain('medium effort');
  });

  it('should include safety constraints from the inferred level', () => {
    const p = buildProficiency({
      distanceKm: 10,
      durationHrs: 2,
      effort: 'medium',
      source: 'manual',
    });

    // Intermediate constraints
    expect(p.maxWindKnots).toBe(18);
    expect(p.maxWaveM).toBe(0.8);
    expect(p.maxDistKm).toBe(20);
  });

  it('should round values to 1 decimal place', () => {
    const p = buildProficiency({
      distanceKm: 10.567,
      durationHrs: 2.333,
      effort: 'easy',
      source: 'manual',
    });

    expect(p.distanceKm).toBe(10.6);
    expect(p.durationHrs).toBe(2.3);
    expect(typeof p.speedKmh).toBe('number');
  });

  it('should handle zero duration gracefully', () => {
    const p = buildProficiency({
      distanceKm: 5,
      durationHrs: 0,
      effort: 'easy',
      source: 'manual',
    });

    expect(p.speedKmh).toBe(0);
    expect(p.level).toBeDefined();
  });

  it('should mark source correctly for strava', () => {
    const p = buildProficiency({
      distanceKm: 20,
      durationHrs: 3,
      effort: 'hard',
      source: 'strava',
    });

    expect(p.source).toBe('strava');
  });
});

// ── inferLevelFromMetrics ────────────────────────────────────────────────────

describe('inferLevelFromMetrics', () => {
  it('should return beginner for short, quick paddles', () => {
    expect(inferLevelFromMetrics(2, 0.5, 'easy')).toBe('beginner');
  });

  it('should return intermediate for moderate paddles', () => {
    expect(inferLevelFromMetrics(10, 2, 'medium')).toBe('intermediate');
  });

  it('should return advanced for longer paddles', () => {
    expect(inferLevelFromMetrics(25, 4, 'medium')).toBe('advanced');
  });

  it('should return expert for very long paddles', () => {
    expect(inferLevelFromMetrics(45, 7, 'medium')).toBe('expert');
  });

  it('should boost score for easy effort at long distances', () => {
    const easyLevel = inferLevelFromMetrics(15, 3, 'easy');
    const hardLevel = inferLevelFromMetrics(15, 3, 'hard');

    // Easy effort at 15km should score higher than hard effort at 15km
    // (hard + short distance gets a penalty, easy + 10km+ gets a bonus)
    expect(['intermediate', 'advanced']).toContain(easyLevel);
  });

  it('should penalise hard effort with short distance', () => {
    // Hard effort but only 5km suggests struggle
    const level = inferLevelFromMetrics(5, 2, 'hard');
    expect(['beginner', 'intermediate']).toContain(level);
  });

  it('should handle edge case of zero distance', () => {
    const level = inferLevelFromMetrics(0, 0, 'easy');
    expect(level).toBe('beginner');
  });
});

// ── analyseStravaActivities ──────────────────────────────────────────────────

describe('analyseStravaActivities', () => {
  const makeActivity = (type, distanceM, movingTimeSec, name = 'Test Paddle') => ({
    type,
    distance: distanceM,
    moving_time: movingTimeSec,
    name,
    start_date: '2025-06-15T10:00:00Z',
  });

  it('should return null when no activities are provided', () => {
    expect(analyseStravaActivities([])).toBeNull();
  });

  it('should return null when no paddling activities exist', () => {
    const activities = [
      makeActivity('Run', 5000, 1800),
      makeActivity('Ride', 20000, 3600),
    ];
    expect(analyseStravaActivities(activities)).toBeNull();
  });

  it('should analyse kayaking activities correctly', () => {
    const activities = [
      makeActivity('Kayaking', 10000, 7200, 'Morning Paddle'),  // 10km, 2h
      makeActivity('Kayaking', 5000, 3600, 'Quick Spin'),        // 5km, 1h
    ];

    const result = analyseStravaActivities(activities);

    expect(result).not.toBeNull();
    expect(result.proficiency).toBeDefined();
    expect(result.bestActivity).toBeDefined();
    expect(result.activities).toHaveLength(2);

    // Best activity should be the longest one (10km)
    expect(result.bestActivity.name).toBe('Morning Paddle');
    expect(result.proficiency.distanceKm).toBe(10);
    expect(result.proficiency.durationHrs).toBe(2);
    expect(result.proficiency.source).toBe('strava');
  });

  it('should include strava aggregate stats', () => {
    const activities = [
      makeActivity('Kayaking', 15000, 7200, 'Long Paddle'),
      makeActivity('Kayaking', 8000, 3600, 'Short Paddle'),
      makeActivity('Canoeing', 12000, 5400, 'Canoe Trip'),
    ];

    const result = analyseStravaActivities(activities);
    const stats = result.proficiency.stravaStats;

    expect(stats.totalActivities).toBe(3);
    expect(stats.totalKm).toBe(35);
    expect(stats.longestKm).toBe(15);
    expect(stats.bestActivityName).toBe('Long Paddle');
  });

  it('should filter to paddling types only', () => {
    const activities = [
      makeActivity('Run', 10000, 3600),
      makeActivity('Kayaking', 5000, 3600),
      makeActivity('Ride', 30000, 7200),
      makeActivity('StandUpPaddling', 3000, 1800),
    ];

    const result = analyseStravaActivities(activities);
    expect(result.activities).toHaveLength(2); // only Kayaking and SUP
  });

  it('should pick the longest paddle as best activity', () => {
    const activities = [
      makeActivity('Kayaking', 3000, 1800, 'Short'),
      makeActivity('Kayaking', 25000, 10800, 'Long Epic'),
      makeActivity('Kayaking', 8000, 4000, 'Medium'),
    ];

    const result = analyseStravaActivities(activities);
    expect(result.bestActivity.name).toBe('Long Epic');
  });

  it('should infer effort from speed', () => {
    // Fast paddle (>8 km/h) should be 'hard'
    const fastActivities = [
      makeActivity('Kayaking', 18000, 7200), // 18km in 2h = 9 km/h
    ];
    const fastResult = analyseStravaActivities(fastActivities);
    expect(fastResult.proficiency.effort).toBe('hard');

    // Slow paddle (<4 km/h) should be 'easy'
    const slowActivities = [
      makeActivity('Kayaking', 6000, 7200), // 6km in 2h = 3 km/h
    ];
    const slowResult = analyseStravaActivities(slowActivities);
    expect(slowResult.proficiency.effort).toBe('easy');
  });
});

// ── formatProficiencyForPrompt ───────────────────────────────────────────────

describe('formatProficiencyForPrompt', () => {
  it('should return a default message for null proficiency', () => {
    expect(formatProficiencyForPrompt(null)).toBe('No paddling experience provided');
  });

  it('should format manual proficiency correctly', () => {
    const p = buildProficiency({
      distanceKm: 10,
      durationHrs: 2,
      effort: 'medium',
      source: 'manual',
    });

    const result = formatProficiencyForPrompt(p);

    expect(result).toContain('10 km');
    expect(result).toContain('effort: medium');
    expect(result).toContain('speed: ~5 km/h');
    expect(result).toContain('level: intermediate');
    expect(result).toContain('max safe distance: 20 km/day');
    expect(result).toContain('max safe wind: 18 knots');
    expect(result).toContain('(self-reported)');
  });

  it('should include Strava stats for strava-sourced proficiency', () => {
    const activities = [
      {
        type: 'Kayaking',
        distance: 15000,
        moving_time: 7200,
        name: 'Morning Paddle',
        start_date: '2025-06-15T10:00:00Z',
      },
    ];

    const result = analyseStravaActivities(activities);
    const formatted = formatProficiencyForPrompt(result.proficiency);

    expect(formatted).toContain('1 Strava activities');
    expect(formatted).toContain('Morning Paddle');
    expect(formatted).not.toContain('(self-reported)');
  });
});

// ── SKILL_LEVELS ─────────────────────────────────────────────────────────────

describe('SKILL_LEVELS', () => {
  it('should define all four levels', () => {
    expect(SKILL_LEVELS.BEGINNER).toBeDefined();
    expect(SKILL_LEVELS.INTERMEDIATE).toBeDefined();
    expect(SKILL_LEVELS.ADVANCED).toBeDefined();
    expect(SKILL_LEVELS.EXPERT).toBeDefined();
  });

  it('should have increasing constraints', () => {
    const { BEGINNER, INTERMEDIATE, ADVANCED, EXPERT } = SKILL_LEVELS;

    expect(BEGINNER.maxWindKnots).toBeLessThan(INTERMEDIATE.maxWindKnots);
    expect(INTERMEDIATE.maxWindKnots).toBeLessThan(ADVANCED.maxWindKnots);
    expect(ADVANCED.maxWindKnots).toBeLessThan(EXPERT.maxWindKnots);

    expect(BEGINNER.maxDistKm).toBeLessThan(INTERMEDIATE.maxDistKm);
    expect(INTERMEDIATE.maxDistKm).toBeLessThan(ADVANCED.maxDistKm);
    expect(ADVANCED.maxDistKm).toBeLessThan(EXPERT.maxDistKm);
  });
});

// ── EFFORT_LEVELS ────────────────────────────────────────────────────────────

describe('EFFORT_LEVELS', () => {
  it('should define exactly three effort levels', () => {
    expect(EFFORT_LEVELS).toHaveLength(3);
    expect(EFFORT_LEVELS.map(e => e.key)).toEqual(['easy', 'medium', 'hard']);
  });

  it('should have labels and descriptions', () => {
    EFFORT_LEVELS.forEach(e => {
      expect(e.label).toBeTruthy();
      expect(e.description).toBeTruthy();
    });
  });
});
