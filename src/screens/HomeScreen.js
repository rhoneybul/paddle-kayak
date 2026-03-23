import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import MapSketch from '../components/MapSketch';
import { AlertBanner } from '../components/UI';
import { getCurrentUser, signOut } from '../services/authService';
import {
  connectStrava, disconnectStrava, getStravaTokens, getStravaAthlete,
  handleStravaWebCallback, isStravaConfigured,
} from '../services/stravaService';
import StravaLogo from '../components/StravaLogo';

// Throttle interval for live location updates (ms) — balance accuracy vs battery
const LOCATION_UPDATE_INTERVAL = 5000;

export default function HomeScreen({ navigation }) {
  const [name, setName]                   = useState(null);
  const [location, setLocation]           = useState(null);   // { label, coords }
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [heading, setHeading]             = useState(null);
  const [stravaAthlete, setStravaAthlete] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaError, setStravaError]     = useState(null);
  const locationSubRef = useRef(null);

  // Load display name from auth
  useEffect(() => {
    getCurrentUser().then(user => {
      const displayName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name      ||
        user?.email?.split('@')[0]     || null;
      setName(displayName);
    });
  }, []);

  // Get GPS location + reverse-geocode to place name, with live tracking
  useEffect(() => {
    let locationSub = null;
    let mounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (mounted) {
            setPermissionDenied(true);
            setLocation({ label: 'Location unavailable', coords: null });
          }
          return;
        }
        if (mounted) setPermissionDenied(false);

        // Initial high-accuracy position for centering
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const { latitude: lat, longitude: lon } = pos.coords;

        if (mounted) {
          setLocation(prev => ({
            label: prev?.label || 'Your location',
            coords: { lat, lon },
          }));
        }

        // Reverse geocode via Nominatim (free, no key)
        try {
          const res  = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
            { headers: { 'User-Agent': 'PaddleApp/1.0' } },
          );
          const data = await res.json();
          const label =
            data.address?.city    ||
            data.address?.town    ||
            data.address?.village ||
            data.address?.county  ||
            'Your location';
          if (mounted) setLocation({ label, coords: { lat, lon } });
        } catch {
          if (mounted) setLocation({ label: 'Your location', coords: { lat, lon } });
        }

        // Start throttled live location updates
        locationSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_UPDATE_INTERVAL,
            distanceInterval: 5, // minimum 5 meters between updates
          },
          (newPos) => {
            if (mounted) {
              setLocation(prev => ({
                label: prev?.label || 'Your location',
                coords: {
                  lat: newPos.coords.latitude,
                  lon: newPos.coords.longitude,
                },
              }));
              if (newPos.coords.heading != null && newPos.coords.heading >= 0) {
                setHeading(newPos.coords.heading);
              }
            }
          },
        );
        locationSubRef.current = locationSub;
      } catch {
        if (mounted) setLocation({ label: 'Location unavailable', coords: null });
      }
    })();

    return () => {
      mounted = false;
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, []);

  // Load Strava connection state
  const loadStrava = useCallback(async () => {
    const tokens = await getStravaTokens();
    if (tokens) {
      setStravaConnected(true);
      const athlete = await getStravaAthlete();
      setStravaAthlete(athlete);
    } else {
      setStravaConnected(false);
      setStravaAthlete(null);
    }
  }, []);

  useEffect(() => {
    loadStrava();

    // Web: handle Strava OAuth return (Strava appends ?code=&scope= to the redirect URL)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');
      const scope  = params.get('scope'); // scope is Strava-specific; Supabase doesn't send it
      if (code && scope) {
        window.history.replaceState({}, '', window.location.pathname); // clean URL
        setStravaLoading(true);
        handleStravaWebCallback(code)
          .then(athlete => {
            setStravaConnected(true);
            setStravaAthlete(athlete);
          })
          .catch(err => setStravaError(err.message))
          .finally(() => setStravaLoading(false));
      }
    }
  }, []);

  const handleConnectStrava = async () => {
    setStravaLoading(true);
    setStravaError(null);
    try {
      const athlete = await connectStrava();
      if (athlete) {
        // Mobile path: connectStrava() resolves with the athlete
        setStravaConnected(true);
        setStravaAthlete(athlete);
      }
      // Web path: connectStrava() redirects the page — nothing more to do here
    } catch (err) {
      setStravaError(err.message);
    } finally {
      if (Platform.OS !== 'web') setStravaLoading(false);
    }
  };

  const handleDisconnectStrava = async () => {
    await disconnectStrava();
    setStravaConnected(false);
    setStravaAthlete(null);
  };

  const handleSignOut = async () => {
    await signOut();
    navigation.replace('SignIn');
  };

  const firstName = name?.split(' ')[0] ?? null;

  // Coordinate label for map overlay
  const coordLabel = (() => {
    if (!location?.coords) return null;
    const { lat, lon } = location.coords;
    return `${Math.abs(lat).toFixed(3)}\u00b0${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(3)}\u00b0${lon >= 0 ? 'E' : 'W'}`;
  })();

  // Map position: centre the blue dot in the sketch when we have coordinates
  const mapPos = location?.coords ? { x: 138, y: 155 } : null;

  return (
    <View style={s.container}>

      {/* Map — blue dot centred in the sketch */}
      <View style={s.mapContainer}>
        <MapSketch
          height={310}
          myPos={mapPos}
          heading={heading}
          overlayTitle={location ? location.label : 'Locating\u2026'}
          overlayMeta={coordLabel}
        />

        {/* Search bar overlay */}
        <SafeAreaView style={s.searchOverlay} edges={['top']} pointerEvents="box-none">
          <TouchableOpacity
            style={s.searchBar}
            onPress={() => navigation.navigate('Planner')}
            activeOpacity={0.9}
          >
            <View style={s.searchIcon}>
              <View style={s.searchIconDot} />
            </View>
            <Text style={s.searchPlaceholder}>Plan a paddle route…</Text>
            <View style={s.searchRight}>
              <View style={s.searchBtn}><Text style={s.searchBtnText}>AI</Text></View>
            </View>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Map controls */}
        <View style={s.mapControls}>
          <TouchableOpacity style={s.mapCtrlBtn} activeOpacity={0.8}>
            <Text style={s.mapCtrlText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.mapCtrlBtn, s.mapCtrlBtnBorder]} activeOpacity={0.8}>
            <Text style={s.mapCtrlText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.mapCtrlBtn, { marginTop: 8 }]} activeOpacity={0.8}>
            <Text style={s.mapCtrlText}>◎</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom sheet */}
      <SafeAreaView style={s.sheet} edges={['bottom']}>

        {/* Sheet handle */}
        <View style={s.handle} />

        {/* Permission denied alert */}
        {permissionDenied && (
          <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.8}>
            <AlertBanner
              type="caution"
              title="Location access denied"
              body="Tap to open Settings and enable location to see your position on the map."
            />
          </TouchableOpacity>
        )}

        {/* Sheet header */}
        <View style={s.sheetHeader}>
          <View style={s.sheetIconWrap}>
            <View style={s.sheetIcon} />
          </View>
          <View style={s.sheetTitleWrap}>
            <Text style={s.sheetTitle}>
              {firstName ? `${firstName}'s Trips` : 'My Trips'}
            </Text>
            <Text style={s.sheetSubtitle}>Plan a new paddle</Text>
          </View>
          <TouchableOpacity onPress={handleSignOut} style={s.sheetMenuBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.sheetMenuText}>···</Text>
          </TouchableOpacity>
        </View>

        {/* Actions card */}
        <View style={s.actionsCard}>
          <TouchableOpacity
            style={s.actionRow}
            onPress={() => navigation.navigate('Planner')}
            activeOpacity={0.75}
          >
            <View style={s.actionIconWrap}>
              <Text style={s.actionIconPlus}>+</Text>
            </View>
            <Text style={s.actionLabel}>Plan New Route</Text>
          </TouchableOpacity>
          <View style={s.actionDivider} />
          <TouchableOpacity
            style={s.actionRow}
            onPress={() => navigation.navigate('History')}
            activeOpacity={0.75}
          >
            <View style={[s.actionIconWrap, s.actionIconNeutral]}>
              <Text style={s.actionIconSymbol}>↑</Text>
            </View>
            <Text style={s.actionLabel}>Export History</Text>
          </TouchableOpacity>
        </View>

        {/* Strava connection */}
        <Text style={s.sectionLabel}>CONNECTIONS</Text>
        <View style={s.stravaRow}>
          <View style={s.stravaLogoWrap}>
            <StravaLogo size={18} />
          </View>
          <View style={[s.statusDot, { backgroundColor: stravaConnected ? colors.good : colors.border }]} />
          <View style={s.stravaLeft}>
            <Text style={s.stravaLabel}>Strava</Text>
            {stravaConnected && stravaAthlete ? (
              <Text style={s.stravaSub}>
                {stravaAthlete.firstname} {stravaAthlete.lastname} · connected
              </Text>
            ) : (
              <Text style={s.stravaSub}>
                {isStravaConfigured() ? 'Not connected' : 'Credentials not set in .env'}
              </Text>
            )}
            {stravaError ? <Text style={s.stravaErr}>{stravaError}</Text> : null}
          </View>
          {isStravaConfigured() && (
            stravaLoading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : stravaConnected ? (
              <TouchableOpacity onPress={handleDisconnectStrava} hitSlop={{ top: 8, bottom: 8, left: 12, right: 0 }}>
                <Text style={s.stravaActionMuted}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleConnectStrava} hitSlop={{ top: 8, bottom: 8, left: 12, right: 0 }}>
                <Text style={s.stravaActionBlue}>Connect</Text>
              </TouchableOpacity>
            )
          )}
        </View>

      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  mapContainer: { position: 'relative' },

  // Search bar overlay
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 16 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingVertical: 11, paddingHorizontal: 14,
    marginTop: 8,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 6,
  },
  searchIcon:       { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  searchIconDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  searchPlaceholder:{ flex: 1, fontSize: 13, fontWeight: '400', color: colors.textMuted },
  searchRight:      { flexShrink: 0 },
  searchBtn:        { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  searchBtnText:    { fontSize: 11, fontWeight: '600', color: colors.primary },

  // Map controls
  mapControls: { position: 'absolute', right: 14, bottom: 16, alignItems: 'center' },
  mapCtrlBtn: {
    width: 38, height: 38,
    backgroundColor: colors.white, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },
  mapCtrlBtnBorder: { borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  mapCtrlText:      { fontSize: 18, fontWeight: '300', color: colors.text, lineHeight: 22 },

  // Bottom sheet
  sheet: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -20,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 8,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderLight,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },

  // Sheet header
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
  },
  sheetIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  sheetIcon:       { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary },
  sheetTitleWrap:  { flex: 1 },
  sheetTitle:      { fontSize: 15, fontWeight: '600', color: colors.text },
  sheetSubtitle:   { fontSize: 11, fontWeight: '400', color: colors.textMuted, marginTop: 1 },
  sheetMenuBtn:    { padding: 4 },
  sheetMenuText:   { fontSize: 18, fontWeight: '600', color: colors.textMid, letterSpacing: 1 },

  // Actions card
  actionsCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: colors.white,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
    overflow: 'hidden',
  },
  actionRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  actionDivider:    { height: 0.5, backgroundColor: colors.borderLight, marginLeft: 52 },
  actionIconWrap:   { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  actionIconNeutral:{ backgroundColor: colors.bgDeep },
  actionIconPlus:   { fontSize: 18, fontWeight: '300', color: '#fff', lineHeight: 22 },
  actionIconSymbol: { fontSize: 14, color: colors.textMid, lineHeight: 18 },
  actionLabel:      { fontSize: 13, fontWeight: '500', color: colors.text },

  // Section label
  sectionLabel: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6,
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7,
  },

  // Strava row
  stravaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16,
    backgroundColor: colors.white,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight,
    padding: 14,
  },
  stravaLogoWrap:     { width: 28, height: 28, borderRadius: 7, backgroundColor: '#FC4C0215', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stravaLeft:         { flex: 1 },
  statusDot:          { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  stravaLabel:        { fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 1 },
  stravaSub:          { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  stravaErr:          { fontSize: 10, fontWeight: '400', color: colors.warn, marginTop: 2 },
  stravaActionBlue:   { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  stravaActionMuted:  { fontSize: 12.5, fontWeight: '400', color: colors.textMuted },
});
