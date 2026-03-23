/**
 * Tests for geocodingService — location search and geocoding logic.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

const {
  searchLocations,
  reverseGeocode,
  MIN_SEARCH_LENGTH,
  SEARCH_DEBOUNCE_MS,
} = require('../services/geocodingService');

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('geocodingService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test('exports searchLocations as a function', () => {
    expect(typeof searchLocations).toBe('function');
  });

  test('exports reverseGeocode as a function', () => {
    expect(typeof reverseGeocode).toBe('function');
  });

  test('exports MIN_SEARCH_LENGTH as a number >= 1', () => {
    expect(typeof MIN_SEARCH_LENGTH).toBe('number');
    expect(MIN_SEARCH_LENGTH).toBeGreaterThanOrEqual(1);
  });

  test('exports SEARCH_DEBOUNCE_MS as a positive number', () => {
    expect(typeof SEARCH_DEBOUNCE_MS).toBe('number');
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  test('searchLocations returns empty array for short queries', async () => {
    const results = await searchLocations('ab');
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('searchLocations returns empty array for null/undefined query', async () => {
    expect(await searchLocations(null)).toEqual([]);
    expect(await searchLocations(undefined)).toEqual([]);
    expect(await searchLocations('')).toEqual([]);
  });

  test('searchLocations parses Nominatim response correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          display_name: 'Bristol, City of Bristol, England, United Kingdom',
          lat: '51.4545',
          lon: '-2.5879',
          type: 'city',
          importance: 0.8,
          address: {
            city: 'Bristol',
            state: 'England',
            country: 'United Kingdom',
          },
        },
      ]),
    });

    const results = await searchLocations('Bristol');
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('label');
    expect(results[0]).toHaveProperty('lat');
    expect(results[0]).toHaveProperty('lng');
    expect(results[0].lat).toBeCloseTo(51.4545, 2);
    expect(results[0].lng).toBeCloseTo(-2.5879, 2);
    expect(results[0].type).toBe('city');
  });

  test('searchLocations throws on failed response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await expect(searchLocations('Bristol')).rejects.toThrow('Geocoding search failed');
  });

  test('reverseGeocode parses response correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        display_name: 'Bristol, City of Bristol, England, United Kingdom',
        lat: '51.4545',
        lon: '-2.5879',
        address: {
          city: 'Bristol',
          state: 'England',
          country: 'United Kingdom',
        },
      }),
    });

    const result = await reverseGeocode(51.4545, -2.5879);
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('lat');
    expect(result).toHaveProperty('lng');
    expect(result.lat).toBeCloseTo(51.4545, 2);
    expect(result.lng).toBeCloseTo(-2.5879, 2);
  });

  test('reverseGeocode throws on failed response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await expect(reverseGeocode(51.4545, -2.5879)).rejects.toThrow('Reverse geocoding failed');
  });
});
