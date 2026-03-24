/**
 * Tests for navigation utilities — extractStartCoords and navigateToStart.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

const { extractStartCoords, navigateToStart } = require('../utils/navigation');
const Linking = require('expo-linking');
const { Alert } = require('react-native');

describe('extractStartCoords', () => {
  test('returns null for null/undefined route', () => {
    expect(extractStartCoords(null)).toBeNull();
    expect(extractStartCoords(undefined)).toBeNull();
  });

  test('extracts from [lat, lon] array format', () => {
    const route = { waypoints: [[50.712, -3.532], [50.715, -3.540]] };
    const result = extractStartCoords(route);
    expect(result).toEqual({ lat: 50.712, lng: -3.532 });
  });

  test('extracts from {latitude, longitude} object format', () => {
    const route = { waypoints: [{ latitude: 50.712, longitude: -3.532 }] };
    const result = extractStartCoords(route);
    expect(result).toEqual({ lat: 50.712, lng: -3.532 });
  });

  test('extracts from {lat, lng} object format', () => {
    const route = { waypoints: [{ lat: 50.712, lng: -3.532 }] };
    const result = extractStartCoords(route);
    expect(result).toEqual({ lat: 50.712, lng: -3.532 });
  });

  test('returns null for empty waypoints array', () => {
    const route = { waypoints: [] };
    expect(extractStartCoords(route)).toBeNull();
  });

  test('falls back to locationCoords when no waypoints', () => {
    const route = { waypoints: [], locationCoords: { lat: 50.712, lng: -3.532 } };
    expect(extractStartCoords(route)).toEqual({ lat: 50.712, lng: -3.532 });
  });

  test('extracts from route_data.waypoints if present', () => {
    const route = {
      route_data: { waypoints: [[51.5, -0.1], [51.51, -0.12]] },
    };
    const result = extractStartCoords(route);
    expect(result).toEqual({ lat: 51.5, lng: -0.1 });
  });
});

describe('navigateToStart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows alert when coordinates are null', async () => {
    await navigateToStart(null, null);
    expect(Alert.alert).toHaveBeenCalledWith('No Coordinates', expect.any(String));
  });

  test('tries native Google Maps URL first on iOS', async () => {
    Linking.canOpenURL.mockResolvedValue(true);
    Linking.openURL.mockResolvedValue(undefined);

    await navigateToStart(50.712, -3.532);

    expect(Linking.canOpenURL).toHaveBeenCalledWith(
      expect.stringContaining('comgooglemaps://')
    );
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('comgooglemaps://')
    );
  });

  test('falls back to web URL when Google Maps app not available', async () => {
    Linking.canOpenURL.mockResolvedValue(false);
    Linking.openURL.mockResolvedValue(undefined);

    await navigateToStart(50.712, -3.532);

    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('https://www.google.com/maps/dir/?api=1&destination=50.712,-3.532')
    );
  });
});
