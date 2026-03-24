/**
 * navigationService — helpers for navigating to a route's start point
 * using Google Maps (native or web fallback).
 */
import { Platform, Alert } from 'react-native';

let Linking;
try {
  Linking = require('expo-linking');
} catch (_) {
  // Fallback if expo-linking not installed
  Linking = require('react-native').Linking;
}

/**
 * Extracts the first coordinate pair from route data.
 * Supports both [[lat,lng], ...] arrays and {lat, lng/lon} objects.
 */
export function extractStartCoords(routeData) {
  if (!routeData) return null;

  // waypoints array: [[lat, lng], ...]
  const waypoints = routeData.waypoints || routeData;
  if (Array.isArray(waypoints) && waypoints.length > 0) {
    const first = waypoints[0];
    if (Array.isArray(first) && first.length >= 2) {
      return { lat: first[0], lng: first[1] };
    }
    if (first && typeof first === 'object' && first.lat != null) {
      return { lat: first.lat, lng: first.lng || first.lon };
    }
  }

  // route_data with embedded waypoints
  if (routeData.route_data?.waypoints) {
    return extractStartCoords(routeData.route_data);
  }

  return null;
}

/**
 * Opens Google Maps with driving directions to the given coordinates.
 * On native: tries comgooglemaps:// first, falls back to web URL.
 * On web: opens in a new tab.
 */
export async function navigateToStart(lat, lng) {
  if (lat == null || lng == null) {
    Alert.alert('No Coordinates', 'Start location coordinates are not available.');
    return;
  }

  const destination = `${lat},${lng}`;
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

  if (Platform.OS === 'web') {
    // On web, open in new tab to avoid leaving PWA
    if (typeof window !== 'undefined') {
      window.open(webUrl, '_blank');
    }
    return;
  }

  // On native, try Google Maps app first
  const nativeUrl = Platform.OS === 'ios'
    ? `comgooglemaps://?daddr=${destination}`
    : `comgooglemaps://?daddr=${destination}`;

  try {
    const supported = await Linking.canOpenURL(nativeUrl);
    if (supported) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch (_) {
    // Fall through to web URL
  }

  // Fallback: open in browser
  try {
    await Linking.openURL(webUrl);
  } catch (_) {
    Alert.alert('Unable to Open Maps', 'Could not open Google Maps. Please check your device settings.');
  }
}
