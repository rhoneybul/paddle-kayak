/**
 * Tests for storageService favorite toggling and offline queue.
 */

const mockStorage = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key) => Promise.resolve(mockStorage[key] || null)),
  setItem: jest.fn((key, value) => { mockStorage[key] = value; return Promise.resolve(); }),
  removeItem: jest.fn((key) => { delete mockStorage[key]; return Promise.resolve(); }),
}));

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    savedRoutes: {
      list: jest.fn().mockRejectedValue(new Error('offline')),
      create: jest.fn().mockRejectedValue(new Error('offline')),
      delete: jest.fn().mockRejectedValue(new Error('offline')),
    },
    paddles: { list: jest.fn().mockRejectedValue(new Error('offline')), stats: jest.fn().mockRejectedValue(new Error('offline')) },
    users: { me: jest.fn().mockRejectedValue(new Error('offline')), update: jest.fn().mockRejectedValue(new Error('offline')) },
  },
}));

const { isRouteSaved, toggleFavorite, flushPendingSyncs } = require('../services/storageService');
const AsyncStorage = require('@react-native-async-storage/async-storage');

describe('storageService favorites', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    jest.clearAllMocks();
  });

  describe('isRouteSaved', () => {
    test('returns null when no routes saved', async () => {
      const result = await isRouteSaved('Test Route');
      expect(result).toBeNull();
    });

    test('returns matching route when found by name', async () => {
      const routes = [{ id: '1', name: 'River Axe Loop', serverId: 'srv-1' }];
      mockStorage['PADDLE_SAVED_ROUTES'] = JSON.stringify(routes);

      const result = await isRouteSaved('River Axe Loop');
      expect(result).toBeTruthy();
      expect(result.name).toBe('River Axe Loop');
    });

    test('returns null when no match', async () => {
      const routes = [{ id: '1', name: 'River Axe Loop', serverId: 'srv-1' }];
      mockStorage['PADDLE_SAVED_ROUTES'] = JSON.stringify(routes);

      const result = await isRouteSaved('Nonexistent Route');
      expect(result).toBeNull();
    });
  });

  describe('toggleFavorite', () => {
    test('saves a new route when not already saved', async () => {
      const route = { name: 'Test Route', waypoints: [[50, -3]], distanceKm: 5 };
      const result = await toggleFavorite(route);

      expect(result.saved).toBe(true);
      expect(result.route).toBeTruthy();
      expect(result.route.name).toBe('Test Route');
    });

    test('removes a route when already saved', async () => {
      // Pre-populate with a saved route
      const routes = [{ id: '123', name: 'Test Route', serverId: null }];
      mockStorage['PADDLE_SAVED_ROUTES'] = JSON.stringify(routes);

      const route = { name: 'Test Route', waypoints: [[50, -3]] };
      const result = await toggleFavorite(route);

      expect(result.saved).toBe(false);
      expect(result.route).toBeNull();
    });
  });

  describe('flushPendingSyncs', () => {
    test('does nothing when no pending syncs', async () => {
      await flushPendingSyncs();
      // Should not throw
    });

    test('processes pending sync items', async () => {
      const queue = [{ action: 'delete_route', id: 'srv-1', queuedAt: Date.now() }];
      mockStorage['PADDLE_PENDING_SYNC'] = JSON.stringify(queue);

      // API will fail (mocked as offline), so items stay in queue
      await flushPendingSyncs();

      const raw = mockStorage['PADDLE_PENDING_SYNC'];
      expect(raw).toBeTruthy();
      const remaining = JSON.parse(raw);
      expect(remaining.length).toBe(1); // Still there because API failed
    });
  });
});
