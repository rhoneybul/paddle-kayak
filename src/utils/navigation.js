/**
 * Navigation helpers — Navigate to Start via Google Maps.
 *
 * Uses expo-linking to open the native Google Maps app on mobile,
 * or a browser tab on web.
 */
import { Platform, Alert } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * Extract the first coordinate pair from route_data or waypoints.
 * Returns { lat, lng } or null.
 */
export function extractStartCoords(route) {
  if (!route) return null;

  // Try route_data first (may contain waypoints)
  const source = route.waypoints || route.route_data?.waypoints || [];

  if (Array.isArray(source) && source.length > 0) {
    const first = source[0];
    // [lat, lon] array format
    if (Array.isArray(first) && first.length >= 2) {
      const lat = parseFloat(first[0]);
      const lng = parseFloat(first[1]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    // { latitude, longitude } object format
    if (first.latitude != null && first.longitude != null) {
      return { lat: parseFloat(first.latitude), lng: parseFloat(first.longitude) };
    }
    // { lat, lng } object format
    if (first.lat != null && first.lng != null) {
      return { lat: parseFloat(first.lat), lng: parseFloat(first.lng) };
    }
  }

  // Fall back to locationCoords on the route
  if (route.locationCoords) {
    return { lat: route.locationCoords.lat, lng: route.locationCoords.lng };
  }

  return null;
}

/**
 * Open Google Maps with driving directions to the given coordinates.
 * On native: tries comgooglemaps:// scheme first, then falls back to web URL.
 * On web: opens in a new tab to avoid navigating away from the PWA.
 */
export async function navigateToStart(lat, lng) {
  if (lat == null || lng == null) {
    Alert.alert('No Coordinates', 'Route start location is not available.');
    return;
  }

  const destination = `${lat},${lng}`;
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

  if (Platform.OS === 'web') {
    // Open in new tab to avoid losing PWA state
    window.open(webUrl, '_blank');
    return;
  }

  // Native: try Google Maps app first
  const nativeUrl = Platform.OS === 'ios'
    ? `comgooglemaps://?daddr=${destination}&directionsmode=driving`
    : `comgooglemaps://?daddr=${destination}`;

  try {
    const supported = await Linking.canOpenURL(nativeUrl);
    if (supported) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch (_) {
    // Google Maps not installed, fall through to web
  }

  // Fallback to web URL
  try {
    await Linking.openURL(webUrl);
  } catch (_) {
    Alert.alert('Navigation Error', 'Could not open maps. Please try again.');
  }
}
