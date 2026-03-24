import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { SectionHeader, PrimaryButton, ErrorState } from '../components/UI';
import { getHistory } from '../services/storageService';

const fmtDur = s => { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function HistoryScreen({ navigation }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      setError(null);
      const h = await getHistory();
      setHistory(h);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  }, [loadHistory]);

  const totalKm = history.reduce((sum, t) => sum + (t.distancePaddled || 0), 0);
  const totalHrs = history.reduce((sum, t) => sum + (t.durationSeconds || 0), 0) / 3600;

  // Group by month
  const byMonth = {};
  history.forEach(t => {
    const key = new Date(t.completedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(t);
  });

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}><Text style={s.backText}>‹</Text></TouchableOpacity>
          <Text style={s.navTitle}>Past Trips</Text>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.good} /></View>
        ) : error ? (
          <ErrorState error={error} onRetry={loadHistory} />
        ) : history.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyTitle}>No trips yet</Text>
            <Text style={s.emptySub}>Your completed paddles will appear here</Text>
            <PrimaryButton label="Plan your first trip \u2192" onPress={() => navigation.navigate('Planner')} style={{ marginTop: 16, marginHorizontal: 0 }} />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
          >

            {/* Summary */}
            <View style={s.summary}>
              {[
                [String(history.length), 'Trips'],
                [totalKm.toFixed(1), 'km'],
                [totalHrs.toFixed(1) + 'h', 'On water'],
              ].map(([val, label], i) => (
                <View key={label} style={[s.summaryCell, i < 2 && s.summaryCellBorder]}>
                  <Text style={s.summaryVal}>{val}</Text>
                  <Text style={s.summaryLabel}>{label}</Text>
                </View>
              ))}
            </View>

            {Object.entries(byMonth).map(([month, trips]) => (
              <View key={month}>
                <SectionHeader>{month}</SectionHeader>
                <View style={s.card}>
                  {trips.map((t, i) => (
                    <View key={t.id || i}>
                      {i > 0 && <View style={s.sep} />}
                      <View style={s.tripRow}>
                        <View style={s.tripLeft}>
                          <Text style={s.tripName}>{t.route?.name || 'Paddle'}</Text>
                          <Text style={s.tripMeta}>{fmtDate(t.completedAt)} · {t.skillLevel?.label || 'Intermediate'}</Text>
                          <View style={s.tripTags}>
                            {t.weather?.current?.windSpeed && <Text style={s.tag}>{t.weather.current.windSpeed} kts</Text>}
                            {t.durationSeconds && <Text style={s.tag}>{fmtDur(t.durationSeconds)}</Text>}
                            {t.weather?.current?.waveHeight && <Text style={s.tag}>{t.weather.current.waveHeight.toFixed(1)}m swell</Text>}
                          </View>
                        </View>
                        <View style={s.tripRight}>
                          <Text style={s.tripKm}>{(t.distancePaddled || 0).toFixed(1)}</Text>
                          <Text style={s.tripKmLabel}>km</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.good },
  navTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  emptySub: { fontSize: 13, fontWeight: '300', color: colors.textMuted, textAlign: 'center' },
  summary: { flexDirection: 'row', marginHorizontal: 12, marginTop: 8, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  summaryCell: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  summaryCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryVal: { fontSize: 22, fontWeight: '300', color: colors.text, lineHeight: 24 },
  summaryLabel: { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  card: { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  sep: { height: 0.5, backgroundColor: colors.borderLight },
  tripRow: { flexDirection: 'row', padding: 12, paddingVertical: 11, alignItems: 'flex-start' },
  tripLeft: { flex: 1 },
  tripName: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 2 },
  tripMeta: { fontSize: 10, fontWeight: '300', color: colors.textMuted, marginBottom: 4 },
  tripTags: { flexDirection: 'row', gap: 8 },
  tag: { fontSize: 10, fontWeight: '300', color: colors.textMid },
  tripRight: { alignItems: 'flex-end', paddingTop: 2 },
  tripKm: { fontSize: 20, fontWeight: '400', color: colors.text, lineHeight: 22 },
  tripKmLabel: { fontSize: 9, fontWeight: '300', color: colors.textMuted },
});
