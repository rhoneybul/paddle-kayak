/**
 * Tests for claudeService — API key detection and prompt building.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

describe('claudeService', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('hasApiKey returns false when no key set', () => {
    delete process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
    const { hasApiKey } = require('../services/claudeService');
    expect(hasApiKey()).toBe(false);
  });

  test('hasApiKey returns true when key is set', () => {
    process.env.EXPO_PUBLIC_CLAUDE_API_KEY = 'sk-ant-test-key-123';
    const { hasApiKey } = require('../services/claudeService');
    expect(hasApiKey()).toBe(true);
  });

  test('planPaddle throws when no API key', async () => {
    delete process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
    const { planPaddle } = require('../services/claudeService');
    await expect(planPaddle('test prompt')).rejects.toThrow();
  });

  test('planPaddle is exported as a function', () => {
    const { planPaddle } = require('../services/claudeService');
    expect(typeof planPaddle).toBe('function');
  });
});
