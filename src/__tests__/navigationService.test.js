/**
 * Tests for navigationService — coordinate extraction and Google Maps integration.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Alert: { alert: jest.fn() },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn().mockResolvedValue(undefined),
}));

const { extractStartCoords } = require('../services/navigationService');

describe('navigationService', () => {
  describe('extractStartCoords', () => {
    test('returns null for null/undefined input', () => {
      expect(extractStartCoords(null)).toBe(null);
      expect(extractStartCoords(undefined)).toBe(null);
    });

    test('extracts coords from array of [lat, lng] pairs', () => {
      const result = extractStartCoords({ waypoints: [[50.72, -3.53], [50.73, -3.52]] });
      expect(result).toEqual({ lat: 50.72, lng: -3.53 });
    });

    test('extracts coords from flat array of [lat, lng] pairs', () => {
      const result = extractStartCoords([[51.5, -0.1], [51.6, -0.2]]);
      expect(result).toEqual({ lat: 51.5, lng: -0.1 });
    });

    test('extracts coords from array of {lat, lng} objects', () => {
      const result = extractStartCoords({ waypoints: [{ lat: 50.72, lng: -3.53 }] });
      expect(result).toEqual({ lat: 50.72, lng: -3.53 });
    });

    test('extracts coords from {lat, lon} objects', () => {
      const result = extractStartCoords({ waypoints: [{ lat: 50.72, lon: -3.53 }] });
      expect(result).toEqual({ lat: 50.72, lng: -3.53 });
    });

    test('handles nested route_data with waypoints', () => {
      const result = extractStartCoords({
        route_data: { waypoints: [[50.72, -3.53], [50.73, -3.52]] },
      });
      expect(result).toEqual({ lat: 50.72, lng: -3.53 });
    });

    test('returns null for empty waypoints array', () => {
      expect(extractStartCoords({ waypoints: [] })).toBe(null);
    });

    test('returns null for empty array', () => {
      expect(extractStartCoords([])).toBe(null);
    });
  });
});
