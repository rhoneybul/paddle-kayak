import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import PaddleMap from '../components/PaddleMap';
import { getActiveTrip, clearActiveTrip, saveToHistory, addPaddleLogEntry } from '../services/storageService';
import { getWeatherWithCache } from '../services/weatherService';

const pad = n => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
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

export default function ActivePaddleScreen({ navigation, route }) {
  const tripParam = route?.params?.trip || null;

  const [trip, setTrip]           = useState(tripParam);
  const [status, setStatus]       = useState('ready'); // 'ready' | 'tracking' | 'paused'
  const [elapsed, setElapsed]     = useState(0);
  const [distKm, setDistKm]       = useState(0);
  const [speed, setSpeed]         = useState(0);
  const [liveTrack, setLiveTrack] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [weather, setWeather]     = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Refs for values needed inside async callbacks / alert closures
  const timerRef   = useRef(null);
  const locRef     = useRef(null);
  const elapsedRef = useRef(0);
  const distRef    = useRef(0);
  const trackRef   = useRef([]);
  const weatherRef = useRef(null);

  useEffect(() => {
    if (!trip) getActiveTrip().then(t => t && setTrip(t));
    return () => {
      clearInterval(timerRef.current);
      locRef.current?.remove?.();
    };
  }, []);

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
    timerRef.current = setInterval(() => {
      setElapsed(e => { elapsedRef.current = e + 1; return e + 1; });
    }, 1000);
    await startGps();
  }, [startGps]);

  const pause = useCallback(() => {
    setStatus('paused');
    clearInterval(timerRef.current);
    stopGps();
  }, [stopGps]);

  const resume = useCallback(async () => {
    setStatus('tracking');
    timerRef.current = setInterval(() => {
      setElapsed(e => { elapsedRef.current = e + 1; return e + 1; });
    }, 1000);
    await startGps();
  }, [startGps]);

  const finish = useCallback(() => {
    const doFinish = async () => {
      clearInterval(timerRef.current);
      stopGps();
      await saveToHistory({
        id:              `paddle-${Date.now()}`,
        name:            trip?.name || 'Paddle',
        route:           trip,
        distancePaddled: parseFloat(distRef.current.toFixed(2)),
        durationSeconds: elapsedRef.current,
        positions:       trackRef.current,
        completedAt:     Date.now(),
        weather:         weatherRef.current,
      });
      await clearActiveTrip();
      navigation.navigate('CompletedPaddles');
    };
    Alert.alert(
      'Finish Paddle?',
      `${distRef.current.toFixed(1)} km paddled in ${fmtTime(elapsedRef.current)}.`,
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Finish', onPress: doFinish },
      ],
    );
  }, [trip, stopGps, navigation]);

  const cancel = useCallback(() => {
    const doCancel = () => {
      clearInterval(timerRef.current);
      stopGps();
      navigation.goBack();
    };
    if (status === 'ready') { doCancel(); return; }
    Alert.alert(
      'Cancel Paddle?',
      'Progress will not be saved.',
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Cancel', style: 'destructive', onPress: doCancel },
      ],
    );
  }, [status, stopGps, navigation]);

  // ── Weather helpers ────────────────────────────────────────────────────────

  const now = new Date();
  const nowHour = now.getHours();
  const currentHour = weather?.hourly?.find(h => {
    if (!h.time) return false;
    const d = new Date(h.time);
    return d.getDate() === now.getDate() && d.getHours() === nowHour;
  }) ?? weather?.hourly?.[0];

  const upcomingHours = (weather?.hourly ?? [])
    .filter(h => h.time && new Date(h.time).getTime() > now.getTime())
    .slice(0, 4);

  const maxWindSoon  = upcomingHours.reduce((m, h) => Math.max(m, h.windSpeed  ?? 0), 0);
  const maxRainSoon  = upcomingHours.reduce((m, h) => Math.max(m, h.precipitation ?? 0), 0);
  const windBuilding = maxWindSoon > (currentHour?.windSpeed ?? 0) + 5;
  const rainComing   = maxRainSoon > 0.3;

  const windCol = (kt) => kt > 20 ? colors.warn : kt > 12 ? colors.caution : colors.primary;

  // ── Map data ───────────────────────────────────────────────────────────────

  const waypoints = trip?.waypoints || trip?.route?.waypoints || [];
  const mapRoutes = waypoints.length >= 2 ? [{ ...trip, waypoints }] : [];
  const mapCoords = currentPos
    ?? (trip?.location ? { lat: trip.location.lat, lon: trip.location.lon } : null);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>

        {/* Nav */}
        <View style={s.nav}>
          <TouchableOpacity onPress={cancel} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <View style={s.navCenter}>
            {status === 'tracking' && <View style={s.trackDot} />}
            <Text style={s.navTitle}>
              {status === 'ready' ? 'Ready to Paddle' : status === 'paused' ? 'Paused' : 'Tracking'}
            </Text>
          </View>
          {isOffline && <Text style={s.offlineTag}>Offline</Text>}
        </View>

        {/* Map */}
        <PaddleMap
          height={280}
          routes={mapRoutes}
          selectedIdx={mapRoutes.length > 0 ? 0 : -1}
          coords={mapCoords}
          liveTrack={liveTrack}
          simpleRoute
        />

        {/* Stats */}
        <View style={s.statsRow}>
          {[
            [fmtTime(elapsed), 'TIME'],
            [distKm.toFixed(2),  'KM'],
            [String(speed),      'KM/H'],
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

        {/* Weather strip */}
        {currentHour ? (
          <View style={s.weatherStrip}>
            <View style={s.wItem}>
              <Text style={s.wLabel}>WIND NOW</Text>
              <Text style={[s.wValue, { color: windCol(currentHour.windSpeed ?? 0) }]}>
                {Math.round(currentHour.windSpeed ?? 0)} kt
              </Text>
            </View>
            <View style={[s.wItem, s.wBorder]}>
              <Text style={s.wLabel}>RAIN</Text>
              <Text style={[s.wValue, { color: (currentHour.precipitation ?? 0) > 0.3 ? colors.caution : colors.primary }]}>
                {(currentHour.precipitation ?? 0) > 0.2
                  ? `${(currentHour.precipitation).toFixed(1)} mm`
                  : 'Dry'}
              </Text>
            </View>
            {windBuilding && (
              <View style={[s.wItem, s.wBorder]}>
                <Text style={s.wLabel}>WIND ↑</Text>
                <Text style={[s.wValue, { color: colors.caution }]}>
                  {Math.round(maxWindSoon)} kt
                </Text>
              </View>
            )}
            {rainComing && (
              <View style={[s.wItem, s.wBorder]}>
                <Text style={s.wLabel}>RAIN AHEAD</Text>
                <Text style={[s.wValue, { color: colors.caution }]}>Soon</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Controls */}
        <View style={s.controls}>
          {status === 'ready' && (
            <TouchableOpacity style={s.startBtn} onPress={startTracking} activeOpacity={0.85}>
              <Text style={s.startBtnText}>Start Paddle</Text>
            </TouchableOpacity>
          )}

          {(status === 'tracking' || status === 'paused') && (
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
              <TouchableOpacity style={s.cancelBtn} onPress={cancel} activeOpacity={0.85}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SOS */}
          <TouchableOpacity
            style={s.sosBtn}
            onPress={() => navigation.navigate('Emergency')}
            activeOpacity={0.85}
          >
            <Text style={s.sosBtnText}>SOS</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },

  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:   { fontSize: 22, color: colors.primary },
  navCenter:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 4 },
  trackDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warn },
  navTitle:   { fontSize: 15, fontWeight: '600', color: colors.text },
  offlineTag: { fontSize: 10, fontWeight: '300', color: colors.textMuted },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    marginHorizontal: 12, marginTop: 10, marginBottom: 8,
    backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderLight,
    paddingVertical: 14,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statVal:  { fontSize: 26, fontWeight: '300', color: colors.text, lineHeight: 28 },
  statLbl:  { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },
  statDiv:  { width: 0.5, height: 40, backgroundColor: colors.borderLight },

  weatherStrip: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginBottom: 10,
    backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  wItem:   { flex: 1, paddingVertical: 9, alignItems: 'center' },
  wBorder: { borderLeftWidth: 0.5, borderLeftColor: colors.borderLight },
  wLabel:  { fontSize: 7, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  wValue:  { fontSize: 13, fontWeight: '500', color: colors.text },

  controls: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  ctrlRow:  { flexDirection: 'row', gap: 8 },

  startBtn:      { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  startBtnText:  { fontSize: 16, fontWeight: '600', color: '#fff' },

  pauseBtn:      { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  pauseBtnText:  { fontSize: 14, fontWeight: '500', color: colors.text },

  resumeBtn:     { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.primary },
  resumeBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  finishBtn:     { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.primary },
  finishBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  cancelBtn:     { paddingHorizontal: 16, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.borderLight },
  cancelBtnText: { fontSize: 14, fontWeight: '400', color: colors.textMuted },

  sosBtn:     { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.warn },
  sosBtnText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 1 },
});
