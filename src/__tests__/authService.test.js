/**
 * Tests for authService — verifying Google-only auth and Apple removal.
 */

// Mock dependencies before importing
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2' }, error: null }),
      signOut: jest.fn().mockResolvedValue({}),
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      setSession: jest.fn().mockResolvedValue({ data: {}, error: null }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  })),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

describe('authService', () => {
  let authModule;

  beforeAll(() => {
    // Set env vars before requiring
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    authModule = require('../services/authService');
  });

  test('exports signInWithGoogle', () => {
    expect(typeof authModule.signInWithGoogle).toBe('function');
  });

  test('does NOT export signInWithApple', () => {
    expect(authModule.signInWithApple).toBeUndefined();
  });

  test('exports signOut', () => {
    expect(typeof authModule.signOut).toBe('function');
  });

  test('exports getCurrentUser', () => {
    expect(typeof authModule.getCurrentUser).toBe('function');
  });

  test('exports getSession', () => {
    expect(typeof authModule.getSession).toBe('function');
  });

  test('exports onAuthStateChange', () => {
    expect(typeof authModule.onAuthStateChange).toBe('function');
  });

  test('isSupabaseConfigured is true when env vars set', () => {
    expect(authModule.isSupabaseConfigured).toBe(true);
  });
});
