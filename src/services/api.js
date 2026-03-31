/**
 * Solvaa API client
 *
 * In development:  calls http://localhost:3001
 * In production:   calls EXPO_PUBLIC_API_URL (set in .env)
 *
 * Every request automatically attaches the Supabase JWT so the
 * server can verify who's calling.
 */

import { getSession } from './authService';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

async function getToken() {
  try {
    const session = await getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

async function request(method, path, body) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `API error ${res.status}`);
  return data;
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const api = {
  users: {
    me:     ()        => request('GET',   '/api/users/me'),
    update: (updates) => request('PATCH', '/api/users/me', updates),
  },

  // ── Trips ──────────────────────────────────────────────────────────────────
  trips: {
    list:   ()          => request('GET',    '/api/trips'),
    get:    (id)        => request('GET',    `/api/trips/${id}`),
    create: (trip)      => request('POST',   '/api/trips', trip),
    update: (id, data)  => request('PATCH',  `/api/trips/${id}`, data),
    delete: (id)        => request('DELETE', `/api/trips/${id}`),
  },

  // ── Paddles (completed sessions) ──────────────────────────────────────────
  paddles: {
    list:   ()        => request('GET',  '/api/paddles'),
    stats:  ()        => request('GET',  '/api/paddles/stats'),
    get:    (id)      => request('GET',  `/api/paddles/${id}`),
    create: (paddle)  => request('POST',   '/api/paddles', paddle),
    delete: (id)      => request('DELETE', `/api/paddles/${id}`),
  },

  // ── Saved routes ──────────────────────────────────────────────────────────
  savedRoutes: {
    list:   ()        => request('GET',    '/api/saved-routes'),
    create: (route)   => request('POST',   '/api/saved-routes', route),
    delete: (id)      => request('DELETE', `/api/saved-routes/${id}`),
  },

  // ── Campsites (no auth needed) ────────────────────────────────────────────
  campsites: {
    search: (lat, lon, radius = 30) =>
      request('GET', `/api/campsites?lat=${lat}&lon=${lon}&radius=${radius}`),
  },

  // ── Weather proxy ─────────────────────────────────────────────────────────
  weather: {
    get: (lat, lon) =>
      request('GET', `/api/weather?lat=${lat}&lon=${lon}`),
  },

  // ── Points of Interest ──────────────────────────────────────────────────
  pois: {
    search: (lat, lon, radius = 5, types = 'cafe,pub,campsite') =>
      request('GET', `/api/pois?lat=${lat}&lon=${lon}&radius=${radius}&types=${types}`),
  },

  // ── Feedback ────────────────────────────────────────────────────────────
  feedback: {
    create: (data) => request('POST', '/api/feedback', data),
  },
};

export default api;
