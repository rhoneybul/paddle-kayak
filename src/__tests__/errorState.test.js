/**
 * Tests for ErrorState utility — error type classification.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { create: (s) => s },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Animated: {
    Value: jest.fn(() => ({ setValue: jest.fn() })),
    View: 'View',
    timing: jest.fn(() => ({ start: jest.fn() })),
    spring: jest.fn(() => ({ start: jest.fn() })),
  },
  PanResponder: { create: jest.fn(() => ({ panHandlers: {} })) },
}));

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
}));

const { getErrorType } = require('../components/UI');

describe('getErrorType', () => {
  test('returns "default" for null/undefined', () => {
    expect(getErrorType(null)).toBe('default');
    expect(getErrorType(undefined)).toBe('default');
  });

  test('returns "network" for network errors', () => {
    expect(getErrorType(new Error('Network request failed'))).toBe('network');
    expect(getErrorType('fetch failed')).toBe('network');
    expect(getErrorType(new Error('offline'))).toBe('network');
  });

  test('returns "session" for auth errors', () => {
    expect(getErrorType(new Error('JWT expired'))).toBe('session');
    expect(getErrorType(new Error('401 Unauthorized'))).toBe('session');
    expect(getErrorType(new Error('session invalid'))).toBe('session');
    expect(getErrorType(new Error('auth token missing'))).toBe('session');
  });

  test('returns "server" for server errors', () => {
    expect(getErrorType(new Error('500 Internal Server Error'))).toBe('server');
    expect(getErrorType(new Error('server error'))).toBe('server');
  });

  test('returns "default" for unknown errors', () => {
    expect(getErrorType(new Error('something weird happened'))).toBe('default');
    expect(getErrorType('unknown issue')).toBe('default');
  });

  test('handles string errors', () => {
    expect(getErrorType('network failure')).toBe('network');
    expect(getErrorType('server timeout')).toBe('server');
  });
});
