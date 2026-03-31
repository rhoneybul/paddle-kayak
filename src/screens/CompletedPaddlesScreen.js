import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, RefreshControl, ActivityIndicator, useWindowDimensions, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily } from '../theme';
import { HomeIcon, TrashIcon, BackIcon } from '../components/Icons';
import { getHistory, deleteFromHistory } from '../services/storageService';
import PaddleMap from '../components/PaddleMap';

// ── Helpers ───────────────────────────────────────────────────────────────────

const pad = n => (n < 10 ? `0${n}` : `${n}`);
function fmtDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}
function fmtSpeed(distKm, seconds) {
  if (!distKm || !seconds) return null;
  const kmh = (distKm / (seconds / 3600)).toFixed(1);
  return `${kmh} km/h`;
}
function monthKey(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CompletedPaddlesScreen({ navigation }) {
  const [paddles, setPaddles]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showMap, setShowMap]       = useState(true);
  const { height: screenHeight }    = useWindowDimensions();

  const load = useCallback(async () => {
    try {
      const h = await getHistory();
      setPaddles(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh list when returning from PaddleDetail (after a delete)
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => load());
    return unsub;
  }, [navigation, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Totals ──────────────────────────────────────────────────────────────────

  const totalKm  = paddles.reduce((s, p) => s + (p.distancePaddled || 0), 0);
  const totalSec = paddles.reduce((s, p) => s + (p.durationSeconds || 0), 0);
  const avgSpeed = totalSec > 0 ? (totalKm / (totalSec / 3600)) : 0;

  // ── Group by month ──────────────────────────────────────────────────────────

  const sections = [];
  const byMonth = {};
  paddles.forEach(p => {
    const key = monthKey(p.completedAt);
    if (!byMonth[key]) { byMonth[key] = []; sections.push({ title: key, data: byMonth[key] }); }
    byMonth[key].push(p);
  });

  // ── Render helpers ──────────────────────────────────────────────────────────

  const handleDeletePaddle = useCallback((paddle) => {
    const doDelete = async () => {
      const id = paddle?.id || paddle?.serverId;
      if (id) await deleteFromHistory(id);
      await load();
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this paddle? This cannot be undone.')) doDelete();
    } else {
      Alert.alert('Delete Paddle', 'Delete this paddle? This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, [load]);

  const windKt    = p => p.weather?.current?.windSpeed   ?? p.weather?.hourly?.[0]?.windSpeed   ?? null;
  const waveM     = p => p.weather?.current?.waveHeight  ?? p.weather?.hourly?.[0]?.waveHeight  ?? null;
  const avgSpeedP = p => fmtSpeed(p.distancePaddled, p.durationSeconds);

  // Build GPS tracks for the map from all paddles
  const mapRoutes = paddles
    .map(p => {
      const track = (p.gpsTrack && p.gpsTrack.length > 0)
        ? p.gpsTrack
        : (p.route?.waypoints || []).map(w =>
            Array.isArray(w)
              ? { lat: w[0], lon: w[1] }
              : { lat: w.lat || w.latitude, lon: w.lon || w.longitude }
          );
      if (track.length < 2) return null;
      return { ...p, waypoints: track.map(t => [t.lat ?? t.latitude, t.lon ?? t.longitude]).filter(c => c[0] && c[1]) };
    })
    .filter(Boolean);

  // Find a center coord from the first paddle with coords
  const centerCoords = (() => {
    for (const p of paddles) {
      const track = p.gpsTrack?.[0] || p.route?.waypoints?.[0];
      if (track) {
        const lat = Array.isArray(track) ? track[0] : (track.lat || track.latitude);
        const lon = Array.isArray(track) ? track[1] : (track.lon || track.longitude);
        if (lat && lon) return { lat, lon };
      }
      if (p.route?.locationCoords) {
        return { lat: p.route.locationCoords.lat, lon: p.route.locationCoords.lng || p.route.locationCoords.lon };
      }
    }
    return null;
  })();

  const mapHeight = Math.round(screenHeight * 0.3);

  // ── Flat list data: map + summary header + section headers + items ─────────

  const listData = [{ type: 'map' }, { type: 'summary' }];
  sections.forEach(sec => {
    listData.push({ type: 'month', title: sec.title });
    sec.data.forEach(p => listData.push({ type: 'paddle', paddle: p }));
  });

  const renderItem = ({ item }) => {
    if (item.type === 'map') {
      if (mapRoutes.length === 0 && !centerCoords) return null;
      return (
        <View style={{ marginBottom: 8 }}>
          <PaddleMap
            height={mapHeight}
            coords={centerCoords}
            routes={mapRoutes}
            selectedIdx={-1}
            simpleRoute
            showZoomControls
          />
          <Text style={s.mapHint}>{mapRoutes.length} paddle{mapRoutes.length !== 1 ? 's' : ''} on map</Text>
        </View>
      );
    }

    if (item.type === 'summary') {
      return (
        <View style={s.summary}>
          {[
            [String(paddles.length),           'Paddles'],
            [`${totalKm.toFixed(1)} km`,        'Distance'],
            [fmtDuration(totalSec),             'Time on water'],
            [avgSpeed > 0 ? `${avgSpeed.toFixed(1)} km/h` : '—', 'Avg speed'],
          ].map(([val, lbl], i) => (
            <View key={lbl} style={[s.summaryCell, i < 3 && s.summaryCellBorder]}>
              <Text style={s.summaryVal}>{val}</Text>
              <Text style={s.summaryLbl}>{lbl}</Text>
            </View>
          ))}
        </View>
      );
    }

    if (item.type === 'month') {
      return <Text style={s.monthLabel}>{item.title}</Text>;
    }

    const p       = item.paddle;
    const wt      = windKt(p);
    const wv      = waveM(p);
    const spd     = avgSpeedP(p);
    const name    = p.name || p.route?.name || 'Paddle';
    const location = p.route?.location || p.route?.launchPoint || null;

    return (
      <TouchableOpacity
        style={s.paddleCard}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('PaddleDetail', { paddle: p })}
      >
        <View style={s.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.paddleName} numberOfLines={1}>{name}</Text>
            {location ? <Text style={s.paddleLocation} numberOfLines={1}>{location}</Text> : null}
            <Text style={s.paddleDate}>{fmtDate(p.completedAt)}</Text>
          </View>
          <View style={s.cardRight}>
            <Text style={s.distVal}>{(p.distancePaddled || 0).toFixed(1)}</Text>
            <Text style={s.distLbl}>km</Text>
          </View>
          <TouchableOpacity
            style={s.deleteBtn}
            onPress={() => handleDeletePaddle(p)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <TrashIcon size={15} color={colors.warn} />
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statLbl}>Duration</Text>
            <Text style={s.statVal}>{fmtDuration(p.durationSeconds)}</Text>
          </View>
          {spd && (
            <View style={[s.stat, s.statBorder]}>
              <Text style={s.statLbl}>Avg speed</Text>
              <Text style={s.statVal}>{spd}</Text>
            </View>
          )}
          {wt != null && (
            <View style={[s.stat, s.statBorder]}>
              <Text style={s.statLbl}>Wind</Text>
              <Text style={[s.statVal, { color: wt > 20 ? colors.warn : wt > 12 ? colors.caution : colors.primary }]}>
                {Math.round(wt)} kt
              </Text>
            </View>
          )}
          {wv != null && (
            <View style={[s.stat, s.statBorder]}>
              <Text style={s.statLbl}>Swell</Text>
              <Text style={s.statVal}>{wv.toFixed(1)} m</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.navBtn}>
            <BackIcon size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={s.navTitle}>Completed Paddles</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.navBtn}>
            <HomeIcon size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : paddles.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>No paddles yet</Text>
            <Text style={s.emptySub}>
              Start tracking a paddle and your completed sessions will appear here.
            </Text>
            <TouchableOpacity
              style={s.trackBtn}
              onPress={() => navigation.navigate('ActivePaddle')}
              activeOpacity={0.85}
            >
              <Text style={s.trackBtnText}>Start a paddle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item, i) => item.type + i}
            contentContainerStyle={s.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
            renderItem={renderItem}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const P = 20;
const FF = fontFamily;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },

  nav:      { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  navBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginHorizontal: 4 },

  list: { paddingHorizontal: P, paddingBottom: P, gap: 0 },
  mapHint: { fontSize: 10, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, textAlign: 'center', paddingVertical: 6 },

  summary: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 18, overflow: 'hidden',
    marginBottom: 14,
    shadowColor: '#1a1d26', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  summaryCell:       { flex: 1, paddingVertical: 14, alignItems: 'center' },
  summaryCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryVal:        { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.text, lineHeight: 17 },
  summaryLbl:        { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 },

  monthLabel: { fontSize: 10, fontWeight: '600', fontFamily: FF.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 10 },

  paddleCard: {
    backgroundColor: colors.white, borderRadius: 18,
    marginBottom: 8, padding: 16, overflow: 'hidden',
    shadowColor: '#1a1d26', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  cardTop:        { flexDirection: 'row', marginBottom: 10 },
  cardRight:      { alignItems: 'flex-end', paddingTop: 2, marginRight: 10 },
  deleteBtn:      { padding: 4, alignSelf: 'flex-start', marginTop: 2 },
  paddleName:     { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginBottom: 2 },
  paddleLocation: { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginBottom: 1 },
  paddleDate:     { fontSize: 12, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted },
  distVal:        { fontSize: 20, fontWeight: '500', fontFamily: FF.medium, color: colors.text, lineHeight: 22 },
  distLbl:        { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },

  statsRow:   { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colors.borderLight, paddingTop: 12 },
  stat:       { flex: 1, alignItems: 'center' },
  statBorder: { borderLeftWidth: 0.5, borderLeftColor: colors.borderLight },
  statLbl:    { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  statVal:    { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.text },

  emptyTitle: { fontSize: 17, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  emptySub:   { fontSize: 15, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  trackBtn:   { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 4 },
  trackBtnText: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
});
