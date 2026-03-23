/**
 * Tests for PlannerScreen validation functions — date and duration validation.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { create: (s) => s },
  Animated: {
    Value: jest.fn(() => ({ setValue: jest.fn() })),
    View: 'View',
    ScrollView: 'ScrollView',
    timing: jest.fn(() => ({ start: jest.fn() })),
    loop: jest.fn(() => ({ start: jest.fn() })),
    sequence: jest.fn(),
    delay: jest.fn(),
    spring: jest.fn(() => ({ start: jest.fn() })),
  },
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  Keyboard: { dismiss: jest.fn() },
  Alert: { alert: jest.fn() },
  PanResponder: { create: jest.fn(() => ({ panHandlers: {} })) },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  Line: 'Line',
  Path: 'Path',
  Rect: 'Rect',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const { isDateValid, isDurationValid } = require('../screens/PlannerScreen');

describe('PlannerScreen validation', () => {
  describe('isDateValid', () => {
    test('returns false for null/undefined/empty', () => {
      expect(isDateValid(null)).toBe(false);
      expect(isDateValid(undefined)).toBe(false);
      expect(isDateValid('')).toBe(false);
    });

    test('returns true for today', () => {
      const today = new Date();
      const dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
      expect(isDateValid(dateStr)).toBe(true);
    });

    test('returns true for a future date', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const dateStr = future.getFullYear() + '-' +
        String(future.getMonth() + 1).padStart(2, '0') + '-' +
        String(future.getDate()).padStart(2, '0');
      expect(isDateValid(dateStr)).toBe(true);
    });

    test('returns false for a past date', () => {
      expect(isDateValid('2020-01-01')).toBe(false);
    });

    test('returns true for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.getFullYear() + '-' +
        String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
        String(tomorrow.getDate()).padStart(2, '0');
      expect(isDateValid(dateStr)).toBe(true);
    });
  });

  describe('isDurationValid', () => {
    test('returns false for zero duration', () => {
      expect(isDurationValid(0)).toBe(false);
    });

    test('returns false for negative duration', () => {
      expect(isDurationValid(-1)).toBe(false);
    });

    test('returns true for 1 hour', () => {
      expect(isDurationValid(1)).toBe(true);
    });

    test('returns true for 8 hours', () => {
      expect(isDurationValid(8)).toBe(true);
    });

    test('returns true for 3 hours (default)', () => {
      expect(isDurationValid(3)).toBe(true);
    });

    test('returns false for non-number inputs', () => {
      expect(isDurationValid(null)).toBe(false);
      expect(isDurationValid(undefined)).toBe(false);
      expect(isDurationValid('3')).toBe(false);
    });
  });
});
