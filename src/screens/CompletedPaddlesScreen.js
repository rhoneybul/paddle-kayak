import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { getHistory } from '../services/storageService';

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
  const [paddles, setPaddles]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await getHistory();
      setPaddles(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const windKt    = p => p.weather?.current?.windSpeed   ?? p.weather?.hourly?.[0]?.windSpeed   ?? null;
  const waveM     = p => p.weather?.current?.waveHeight  ?? p.weather?.hourly?.[0]?.waveHeight  ?? null;
  const avgSpeedP = p => fmtSpeed(p.distancePaddled, p.durationSeconds);

  // ── Flat list data: summary header + section headers + items ────────────────

  const listData = [{ type: 'summary' }];
  sections.forEach(sec => {
    listData.push({ type: 'month', title: sec.title });
    sec.data.forEach(p => listData.push({ type: 'paddle', paddle: p }));
  });

  const renderItem = ({ item }) => {
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
      <View style={s.paddleCard}>
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
      </View>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Completed Paddles</Text>
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

const P = 12;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },

  nav:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.primary },
  navTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },

  list: { padding: P, gap: 0 },

  summary: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.borderLight,
    marginBottom: 14,
  },
  summaryCell:       { flex: 1, paddingVertical: 14, alignItems: 'center' },
  summaryCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryVal:        { fontSize: 16, fontWeight: '300', color: colors.text, lineHeight: 18 },
  summaryLbl:        { fontSize: 7, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 },

  monthLabel: { fontSize: 9, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 4 },

  paddleCard: {
    backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderLight,
    marginBottom: 8, padding: 13, overflow: 'hidden',
  },
  cardTop:      { flexDirection: 'row', marginBottom: 10 },
  cardRight:    { alignItems: 'flex-end', paddingTop: 2 },
  paddleName:   { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  paddleLocation: { fontSize: 10, fontWeight: '400', color: colors.textMuted, marginBottom: 1 },
  paddleDate:   { fontSize: 10, fontWeight: '300', color: colors.textMuted },
  distVal:      { fontSize: 24, fontWeight: '300', color: colors.text, lineHeight: 26 },
  distLbl:      { fontSize: 9, fontWeight: '300', color: colors.textMuted },

  statsRow:   { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colors.borderLight, paddingTop: 10 },
  stat:       { flex: 1, alignItems: 'center' },
  statBorder: { borderLeftWidth: 0.5, borderLeftColor: colors.borderLight },
  statLbl:    { fontSize: 7, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  statVal:    { fontSize: 13, fontWeight: '500', color: colors.text },

  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptySub:   { fontSize: 12, fontWeight: '300', color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  trackBtn:   { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  trackBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
