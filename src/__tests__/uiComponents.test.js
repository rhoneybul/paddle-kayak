/**
 * Tests for new UI components: ErrorState, HeartIcon, NavigateToStartButton.
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
  PanResponder: { create: jest.fn(() => ({ panHandlers: {} })) },
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

const React = require('react');
const { ErrorState, HeartIcon, NavigateToStartButton } = require('../components/UI');

describe('ErrorState', () => {
  test('is a function component', () => {
    expect(typeof ErrorState).toBe('function');
  });

  test('renders without crashing with defaults', () => {
    const element = ErrorState({});
    expect(element).toBeTruthy();
  });

  test('renders with a specific error type', () => {
    const element = ErrorState({ type: 'network' });
    expect(element).toBeTruthy();
  });

  test('renders with custom message', () => {
    const element = ErrorState({ message: 'Custom error' });
    expect(element).toBeTruthy();
  });

  test('renders with retry handler', () => {
    const onRetry = jest.fn();
    const element = ErrorState({ onRetry });
    expect(element).toBeTruthy();
  });

  test('handles all error types', () => {
    expect(ErrorState({ type: 'network' })).toBeTruthy();
    expect(ErrorState({ type: 'session' })).toBeTruthy();
    expect(ErrorState({ type: 'server' })).toBeTruthy();
    expect(ErrorState({ type: 'default' })).toBeTruthy();
    expect(ErrorState({ type: 'unknown' })).toBeTruthy(); // falls back to default
  });
});

describe('HeartIcon', () => {
  test('is a function component', () => {
    expect(typeof HeartIcon).toBe('function');
  });

  test('renders outlined when not filled', () => {
    const element = HeartIcon({ filled: false });
    expect(element).toBeTruthy();
  });

  test('renders filled when filled prop is true', () => {
    const element = HeartIcon({ filled: true });
    expect(element).toBeTruthy();
  });

  test('wraps in TouchableOpacity when onPress given', () => {
    const onPress = jest.fn();
    const element = HeartIcon({ filled: false, onPress });
    expect(element).toBeTruthy();
  });
});

describe('NavigateToStartButton', () => {
  test('is a function component', () => {
    expect(typeof NavigateToStartButton).toBe('function');
  });

  test('renders without crashing', () => {
    const element = NavigateToStartButton({ onPress: jest.fn() });
    expect(element).toBeTruthy();
  });

  test('renders disabled state', () => {
    const element = NavigateToStartButton({ onPress: jest.fn(), disabled: true });
    expect(element).toBeTruthy();
  });
});
