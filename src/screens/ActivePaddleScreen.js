import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform, useWindowDimensions, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { colors, fontFamily } from '../theme';
import PaddleMap from '../components/PaddleMap';
import { BackIcon } from '../components/Icons';
import { getActiveTrip, clearActiveTrip, saveToHistory, addPaddleLogEntry } from '../services/storageService';
import { track } from '../services/analyticsService';
import { getWeatherWithCache } from '../services/weatherService';
import { startBackgroundTracking, stopBackgroundTracking, consumeBackgroundTrack, clearBackgroundTrack } from '../services/backgroundLocationTask';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../services/liveActivityService';

const pad = n => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
};

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

function defaultPaddleName() {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `Paddle ${d.getDate()} ${months[d.getMonth()]}`;
}

export default function ActivePaddleScreen({ navigation, route }) {
  useKeepAwake();
  const { height: screenHeight } = useWindowDimensions();
  const mapHeight = Math.round(screenHeight * 0.5);

  const mode       = route?.params?.mode || 'free';
  const savedRoute = route?.params?.savedRoute || null;
  const tripParam  = route?.params?.trip || null;

  const [trip, setTrip]             = useState(tripParam);
  const [status, setStatus]         = useState('ready'); // ready | tracking | paused | finishing
  const [elapsed, setElapsed]       = useState(0);
  const [distKm, setDistKm]         = useState(0);
  const [speed, setSpeed]           = useState(0);
  const [liveTrack, setLiveTrack]   = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [weather, setWeather]       = useState(null);
  const [isOffline, setIsOffline]   = useState(false);
  const [paddleName, setPaddleName] = useState(savedRoute?.name || defaultPaddleName());

  const timerRef     = useRef(null);
  const locRef       = useRef(null);
  const elapsedRef   = useRef(0);
  const distRef      = useRef(0);
  const trackRef     = useRef([]);
  const weatherRef   = useRef(null);
  const startedAtRef = useRef(null);
  const liveActivityRef = useRef(null); // interval for updating Live Activity

  // Nav title
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (!trip) getActiveTrip().then(t => t && setTrip(t));
    // Get initial position immediately so map shows user location before tracking starts
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCurrentPos({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      }
    })();
    return () => {
      clearInterval(timerRef.current);
      clearInterval(liveActivityRef.current);
      locRef.current?.remove?.();
    };
  }, []);

  // Merge background track data when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && status === 'tracking') {
        try {
          const bg = await consumeBackgroundTrack();
          if (bg.track.length > 0) {
            setLiveTrack(prev => {
              const merged = [...prev, ...bg.track];
              trackRef.current = merged;
              return merged;
            });
            if (bg.distKm > distRef.current) {
              distRef.current = bg.distKm;
              setDistKm(parseFloat(bg.distKm.toFixed(2)));
            }
            await clearBackgroundTrack();
          }
        } catch { /* ignore */ }
      }
    });
    return () => sub.remove();
  }, [status]);

  // ── GPS ────────────────────────────────────────────────────────────────────

  const startGps = useCallback(async () => {
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') return;
    locRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      loc => {
        const pos = { lat: loc.coords.latitude, lon: loc.coords.longitude };
        const speedKmh = loc.coords.speed ? +(loc.coords.speed * 3.6).toFixed(1) : 0;
        setSpeed(speedKmh);
        setCurrentPos(pos);
        setLiveTrack(prev => {
          const next = [...prev, pos];
          trackRef.current = next;
          if (next.length > 1) {
            distRef.current += haversineKm(next[next.length - 2], next[next.length - 1]);
            setDistKm(parseFloat(distRef.current.toFixed(2)));
          }
          return next;
        });
        addPaddleLogEntry(pos);
        getWeatherWithCache(pos.lat, pos.lon)
          .then(w => { setWeather(w); weatherRef.current = w; setIsOffline(!!w?.fromCache); })
          .catch(() => setIsOffline(true));
      },
    );
  }, []);

  const stopGps = useCallback(() => {
    locRef.current?.remove?.();
    locRef.current = null;
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────

  const startTracking = useCallback(async () => {
    setStatus('tracking');
    track('paddle_started', { mode, routeName: savedRoute?.name });
    startedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(e => { elapsedRef.current = e + 1; return e + 1; });
    }, 1000);
    await startGps();

    // Start background tracking (iOS/Android — keeps GPS alive when backgrounded)
    if (Platform.OS !== 'web') {
      startBackgroundTracking().catch(() => {});
    }

    // Start Live Activity (iOS 16.1+)
    startLiveActivity({
      paddleName: paddleName || 'Paddle',
      routeName: savedRoute?.name || '',
    });

    // Update Live Activity every 3 seconds
    liveActivityRef.current = setInterval(() => {
      updateLiveActivity({
        distanceKm: distRef.current,
        elapsedSeconds: elapsedRef.current,
        speedKmh: speed,
      });
    }, 3000);
  }, [startGps, paddleName, savedRoute, speed]);

  const pause = useCallback(() => {
    setStatus('paused');
    clearInterval(timerRef.current);
    clearInterval(liveActivityRef.current);
    stopGps();
    if (Platform.OS !== 'web') stopBackgroundTracking().catch(() => {});
  }, [stopGps]);

  const resume = useCallback(async () => {
    setStatus('tracking');
    timerRef.current = setInterval(() => {
      setElapsed(e => { elapsedRef.current = e + 1; return e + 1; });
    }, 1000);
    await startGps();
    if (Platform.OS !== 'web') startBackgroundTracking().catch(() => {});
    liveActivityRef.current = setInterval(() => {
      updateLiveActivity({
        distanceKm: distRef.current,
        elapsedSeconds: elapsedRef.current,
        speedKmh: speed,
      });
    }, 3000);
  }, [startGps, speed]);

  const finish = useCallback(() => {
    clearInterval(timerRef.current);
    clearInterval(liveActivityRef.current);
    stopGps();
    if (Platform.OS !== 'web') stopBackgroundTracking().catch(() => {});
    endLiveActivity({
      distanceKm: distRef.current,
      elapsedSeconds: elapsedRef.current,
    });
    setStatus('finishing');
  }, [stopGps]);

  const savePaddle = useCallback(async () => {
    await saveToHistory({
      id:              `paddle-${Date.now()}`,
      name:            paddleName.trim() || defaultPaddleName(),
      route:           savedRoute || null,
      distancePaddled: parseFloat(distRef.current.toFixed(2)),
      durationSeconds: elapsedRef.current,
      positions:       trackRef.current,
      gpsTrack:        trackRef.current, // also store as gpsTrack for map rendering
      startedAt:       startedAtRef.current,
      completedAt:     Date.now(),
      weather:         weatherRef.current,
      mode:            mode,
    });
    await clearActiveTrip();
    track('paddle_completed', { distanceKm: distRef.current, durationSeconds: elapsedRef.current });
    navigation.navigate('CompletedPaddles');
  }, [paddleName, savedRoute, mode, navigation]);

  const confirm = useCallback((message, onConfirm) => {
    if (Platform.OS === 'web') {
      if (window.confirm(message)) onConfirm();
    } else {
      Alert.alert('Confirm', message, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onConfirm },
      ]);
    }
  }, []);

  const discardPaddle = useCallback(() => {
    confirm('Discard this paddle? Your tracking data will not be saved.', () => {
      clearInterval(timerRef.current);
      stopGps();
      navigation.navigate('Home');
    });
  }, [confirm, stopGps, navigation]);

  const cancel = useCallback(() => {
    const doCancel = () => {
      clearInterval(timerRef.current);
      stopGps();
      navigation.goBack();
    };
    if (status === 'ready') { doCancel(); return; }
    confirm('Cancel this paddle? Progress will not be saved.', doCancel);
  }, [status, confirm, stopGps, navigation]);

  // ── Map data ───────────────────────────────────────────────────────────────

  const routeWaypoints = savedRoute?.waypoints || [];
  const tripWaypoints  = trip?.waypoints || trip?.route?.waypoints || [];
  const allWaypoints   = routeWaypoints.length >= 2 ? routeWaypoints : tripWaypoints;
  const mapRoutes      = allWaypoints.length >= 2 ? [{ ...(savedRoute || trip), waypoints: allWaypoints }] : [];
  const mapCoords      = currentPos
    ?? (savedRoute?.location ? { lat: savedRoute.location.lat, lon: savedRoute.location.lon } : null)
    ?? (trip?.location ? { lat: trip.location.lat, lon: trip.location.lon } : null);

  // ── Nav title text ─────────────────────────────────────────────────────────

  const navTitle = mode === 'route' && savedRoute?.name
    ? savedRoute.name
    : status === 'ready'
      ? 'Paddle Mode'
      : status === 'finishing'
        ? 'Save Paddle'
        : status === 'paused'
          ? 'Paused'
          : 'Paddle Mode';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          {/* Nav */}
          <View style={s.nav}>
            <TouchableOpacity onPress={status === 'finishing' ? undefined : cancel} style={s.back} activeOpacity={0.7}>
              <BackIcon size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={s.navCenter}>
              {status === 'tracking' && <View style={s.trackDot} />}
              <Text style={s.navTitle} numberOfLines={1}>{navTitle}</Text>
            </View>
            {isOffline && <Text style={s.offlineTag}>Offline</Text>}
          </View>

          {/* Map — takes ~55% of screen */}
          <View style={s.mapContainer}>
            <PaddleMap
              height={mapHeight}
              routes={mapRoutes}
              selectedIdx={mapRoutes.length > 0 ? 0 : -1}
              coords={mapCoords}
              liveTrack={liveTrack}
              simpleRoute
              followUser={status === 'tracking' || status === 'paused'}
              showZoomControls
            />
          </View>

          {/* Bottom section */}
          <View style={s.bottomSection}>

            {/* Finishing state — name + save/discard */}
            {status === 'finishing' ? (
              <View style={s.finishingCard}>
                <Text style={s.finishingLabel}>Name your paddle</Text>
                <TextInput
                  style={s.nameInput}
                  value={paddleName}
                  onChangeText={setPaddleName}
                  placeholder="Paddle name"
                  placeholderTextColor={colors.textFaint}
                  autoFocus
                  selectTextOnFocus
                />

                {/* Summary stats in finishing */}
                <View style={s.finishStatsRow}>
                  {[
                    [fmtTime(elapsed), 'Duration'],
                    [distKm.toFixed(2), 'km'],
                    [elapsedRef.current > 0 ? ((distRef.current / (elapsedRef.current / 3600)) || 0).toFixed(1) : '0.0', 'km/h avg'],
                  ].map(([val, lbl], i) => (
                    <View key={lbl} style={s.finishStatCell}>
                      <Text style={s.finishStatVal}>{val}</Text>
                      <Text style={s.finishStatLbl}>{lbl}</Text>
                    </View>
                  ))}
                </View>

                <View style={s.finishBtnRow}>
                  <TouchableOpacity style={s.discardBtn} onPress={discardPaddle} activeOpacity={0.85}>
                    <Text style={s.discardBtnText}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.saveBtn} onPress={savePaddle} activeOpacity={0.85}>
                    <Text style={s.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Stat bar */}
                <View style={s.statsRow}>
                  {[
                    [fmtTime(elapsed), 'Duration'],
                    [distKm.toFixed(2),  'km'],
                    [String(speed),      'km/h'],
                  ].map(([val, lbl], i) => (
                    <React.Fragment key={lbl}>
                      {i > 0 && <View style={s.statDiv} />}
                      <View style={s.statCell}>
                        <Text style={s.statVal}>{val}</Text>
                        <Text style={s.statLbl}>{lbl}</Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>

                {/* Controls */}
                <View style={s.controls}>
                  {status === 'ready' && (
                    <TouchableOpacity style={s.startBtn} onPress={startTracking} activeOpacity={0.85}>
                      <Text style={s.startBtnText}>Start Paddle</Text>
                    </TouchableOpacity>
                  )}

                  {(status === 'tracking' || status === 'paused') && (
                    <>
                      <View style={s.ctrlRow}>
                        {status === 'tracking' ? (
                          <TouchableOpacity style={s.pauseBtn} onPress={pause} activeOpacity={0.85}>
                            <Text style={s.pauseBtnText}>Pause</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={s.resumeBtn} onPress={resume} activeOpacity={0.85}>
                            <Text style={s.resumeBtnText}>Resume</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.finishBtn} onPress={finish} activeOpacity={0.85}>
                          <Text style={s.finishBtnText}>Finish</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity style={s.cancelBtn} onPress={cancel} activeOpacity={0.85}>
                        <Text style={s.cancelBtnText}>Discard Paddle</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* SOS */}
                  {(status === 'tracking' || status === 'paused') && (
                    <TouchableOpacity
                      style={s.sosBtn}
                      onPress={() => navigation.navigate('Emergency')}
                      activeOpacity={0.85}
                    >
                      <Text style={s.sosBtnText}>SOS</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const FF = fontFamily;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },

  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  navCenter:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 4 },
  trackDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warn },
  navTitle:   { fontSize: 17, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  offlineTag: { fontSize: 10, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, backgroundColor: colors.bgDeep, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },

  // Map takes ~55%
  mapContainer: { flex: 55, overflow: 'hidden' },

  // Bottom takes ~45%
  bottomSection: { flex: 45, paddingTop: 12 },

  // Stats card
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: colors.white, borderRadius: 18,
    shadowColor: colors.primary, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 3,
    paddingVertical: 18,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statVal:  { fontSize: 28, fontWeight: '300', fontFamily: FF.light, color: colors.text, lineHeight: 32 },
  statLbl:  { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 3 },
  statDiv:  { width: 0.5, height: 36, backgroundColor: colors.borderLight },

  // Controls
  controls: { paddingHorizontal: 20, gap: 10, flex: 1, justifyContent: 'flex-end', paddingBottom: 8 },
  ctrlRow:  { flexDirection: 'row', gap: 10 },

  startBtn:      { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  startBtnText:  { fontSize: 17, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  pauseBtn:      { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  pauseBtnText:  { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.text },

  resumeBtn:     { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.primary },
  resumeBtnText: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  finishBtn:     { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.primary },
  finishBtnText: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  cancelBtn:     { borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted },

  sosBtn:     { borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.warn },
  sosBtnText: { fontSize: 16, fontWeight: '700', fontFamily: FF.semibold, color: '#fff', letterSpacing: 1 },

  // Finishing state
  finishingCard: {
    flex: 1,
    marginHorizontal: 20,
    backgroundColor: colors.white,
    borderRadius: 18,
    shadowColor: colors.primary, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 3,
    padding: 20,
    marginBottom: 8,
  },
  finishingLabel: { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, marginBottom: 8 },
  nameInput: {
    fontSize: 18, fontWeight: '500', fontFamily: FF.medium, color: colors.text,
    borderBottomWidth: 1.5, borderBottomColor: colors.primary, paddingVertical: 10, marginBottom: 20,
  },
  finishStatsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 24 },
  finishStatCell: { alignItems: 'center' },
  finishStatVal:  { fontSize: 22, fontWeight: '300', fontFamily: FF.light, color: colors.text },
  finishStatLbl:  { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 2 },

  finishBtnRow: { flexDirection: 'row', gap: 12, marginTop: 'auto' },
  discardBtn:     { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  discardBtnText: { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted },
  saveBtn:        { flex: 2, borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.primary },
  saveBtnText:    { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
});
