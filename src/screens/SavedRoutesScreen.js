import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { getSavedRoutes, deleteSavedRoute } from '../services/storageService';
import { getWeatherWithCache } from '../services/weatherService';
import PaddleMap from '../components/PaddleMap';
import ConditionsTimeline from '../components/ConditionsTimeline';
import { gpxRouteBearing } from '../components/PaddleMap';
import { HeartIcon } from '../components/UI';

// ── Date helpers ──────────────────────────────────────────────────────────────

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(str) {
  if (!str) return '';
  const today    = getTodayString();
  if (str === today) return 'Today';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (str === dateToString(tomorrow)) return 'Tomorrow';
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Date strip: today → +13 days (2 weeks)
const DATE_STRIP = (() => {
  const arr = []; const today = new Date();
  for (let i = 0; i <= 13; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    arr.push(dateToString(d));
  }
  return arr;
})();

// ── Component ─────────────────────────────────────────────────────────────────

export default function SavedRoutesScreen({ navigation }) {
  const [routes, setRoutes]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState(null);
  const [viewDate, setViewDate]           = useState(getTodayString());
  const [weather, setWeather]             = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [refreshing, setRefreshing]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRoutes(await getSavedRoutes()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Fetch weather when selected route changes
  useEffect(() => {
    if (!selected?.locationCoords) { setWeather(null); return; }
    let cancelled = false;
    (async () => {
      setWeatherLoading(true);
      try {
        const w = await getWeatherWithCache(selected.locationCoords.lat, selected.locationCoords.lng);
        if (!cancelled) setWeather(w);
      } catch { if (!cancelled) setWeather(null); }
      finally  { if (!cancelled) setWeatherLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const handleDelete = (id) => {
    Alert.alert('Delete Route', 'Remove this route from your saved routes?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteSavedRoute(id);
          await load();
          if (selected?.id === id) setSelected(null);
        },
      },
    ]);
  };

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selected) {
    const routeBearing = selected.waypoints ? gpxRouteBearing(selected.waypoints) : null;

    // Which dates have weather forecast
    const weatherDates = weather
      ? new Set(weather.hourly.map(h => h.time?.slice(0, 10)).filter(Boolean))
      : new Set();

    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          {/* Nav */}
          <View style={s.nav}>
            <TouchableOpacity onPress={() => setSelected(null)} style={s.back}>
              <Text style={s.backText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.navTitle} numberOfLines={1}>{selected.name}</Text>
            <TouchableOpacity onPress={() => handleDelete(selected.id)} style={s.deleteBtn}>
              <Text style={s.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>

          {/* Map — pinned */}
          <PaddleMap
            height={220}
            coords={selected.locationCoords
              ? { lat: selected.locationCoords.lat, lon: selected.locationCoords.lng }
              : undefined}
            routes={[selected]}
            selectedIdx={0}
            overlayTitle={selected.name}
            overlayMeta={selected.launchPoint || selected.location}
          />

          {/* Scrollable content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 48 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
          >
            {/* Stats strip */}
            <View style={s.metaStrip}>
              {[
                ['Distance', selected.distanceKm ? `${selected.distanceKm} km` : '—'],
                ['Duration', `~${selected.estimated_duration}h`],
                ['Terrain',  selected.terrain  || '—'],
                ['Level',    selected.difficulty || '—'],
              ].map(([l, v], i) => (
                <View key={l} style={[s.metaCell, i < 3 && s.metaCellBorder]}>
                  <Text style={s.metaCellLabel}>{l}</Text>
                  <Text style={s.metaCellValue}>{v}</Text>
                </View>
              ))}
            </View>

            {/* Drive info */}
            {selected.travelTimeMin > 0 && (
              <View style={s.driveBadge}>
                <Text style={s.driveBadgeText}>{selected.travelTimeMin} min drive · {selected.travelFromBase}</Text>
              </View>
            )}

            {/* GPX download badge */}
            {selected.gpxUrl && (
              <View style={s.gpxBadge}>
                <Text style={s.gpxBadgeText}>GPX saved to cloud</Text>
              </View>
            )}

            {/* Date strip — pick conditions date */}
            <Text style={s.sectionLabel}>CONDITIONS FOR</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dateStrip}
            >
              {DATE_STRIP.map(dateStr => {
                const active     = viewDate === dateStr;
                const hasWeather = weatherDates.has(dateStr);
                const isToday    = dateStr === getTodayString();
                const d          = new Date(dateStr + 'T12:00:00');
                const dayName    = d.toLocaleDateString('en', { weekday: 'short' });
                return (
                  <TouchableOpacity
                    key={dateStr}
                    style={[s.dateChip, active && s.dateChipActive]}
                    onPress={() => setViewDate(dateStr)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.dateDayName, active && s.dateDayNameActive]}>
                      {isToday ? 'Today' : dayName}
                    </Text>
                    <Text style={[s.dateDayNum, active && s.dateDayNumActive]}>
                      {d.getDate()}
                    </Text>
                    <View style={[
                      s.weatherDot,
                      hasWeather
                        ? (active ? s.weatherDotActive : s.weatherDotHas)
                        : s.weatherDotNone,
                    ]} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Conditions timeline */}
            {weatherLoading ? (
              <View style={s.loadingBox}>
                <Text style={s.loadingText}>Loading conditions…</Text>
              </View>
            ) : !selected.locationCoords ? (
              <View style={s.loadingBox}>
                <Text style={s.loadingText}>No location — conditions unavailable</Text>
              </View>
            ) : weather ? (
              <ConditionsTimeline
                hourly={weather.hourly}
                date={viewDate}
                routeBearing={routeBearing}
              />
            ) : null}

            {/* Description */}
            {selected.description ? (
              <View style={s.descCard}>
                <Text style={s.descText}>{selected.description}</Text>
              </View>
            ) : null}

            {/* Highlights */}
            {selected.highlights?.length > 0 && (
              <View style={s.chipsWrap}>
                {selected.highlights.map((h, i) => (
                  <View key={i} style={s.chip}><Text style={s.chipText}>{h}</Text></View>
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Saved Paddles</Text>
        </View>

        {loading ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>Loading…</Text>
          </View>
        ) : routes.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>No saved routes yet</Text>
            <Text style={s.emptySub}>Generate a plan and tap Save Route to bookmark a paddle</Text>
            <TouchableOpacity
              style={s.planBtn}
              onPress={() => navigation.navigate('Planner')}
              activeOpacity={0.85}
            >
              <Text style={s.planBtnText}>Plan a paddle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={routes}
            keyExtractor={r => r.id}
            contentContainerStyle={s.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
            renderItem={({ item: r }) => (
              <TouchableOpacity style={s.routeCard} onPress={() => setSelected(r)} activeOpacity={0.85}>
                {/* Map thumbnail */}
                <View style={s.mapThumb}>
                  <PaddleMap
                    height={110}
                    coords={r.locationCoords
                      ? { lat: r.locationCoords.lat, lon: r.locationCoords.lng }
                      : undefined}
                    routes={[r]}
                    selectedIdx={0}
                  />
                  {/* Heart icon overlay (Ticket 3) */}
                  <View style={s.heartOverlay}>
                    <HeartIcon filled size={20} />
                  </View>
                </View>
                {/* Route info */}
                <View style={s.routeInfo}>
                  <Text style={s.routeName} numberOfLines={1}>{r.name}</Text>
                  <Text style={s.routeLocation} numberOfLines={1}>{r.location || r.launchPoint || '\u2014'}</Text>
                  <View style={s.routeMeta}>
                    {r.distanceKm  ? <View style={s.metaChip}><Text style={s.metaChipText}>{r.distanceKm} km</Text></View> : null}
                    {r.estimated_duration ? <View style={s.metaChip}><Text style={s.metaChipText}>~{r.estimated_duration}h</Text></View> : null}
                    {r.terrain     ? <View style={s.metaChip}><Text style={s.metaChipText}>{r.terrain}</Text></View> : null}
                    {r.difficulty  ? <View style={s.metaChip}><Text style={s.metaChipText}>{r.difficulty}</Text></View> : null}
                  </View>
                </View>
                <Text style={s.chevron}>{'\u203A'}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const P = 12;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },

  nav:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:          { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:      { fontSize: 22, color: colors.primary },
  navTitle:      { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  deleteBtn:     { paddingHorizontal: 8 },
  deleteBtnText: { fontSize: 13, fontWeight: '500', color: colors.warn },

  // List
  list:        { padding: P, gap: 10 },
  routeCard:   { backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  mapThumb:    { overflow: 'hidden', position: 'relative' },
  heartOverlay: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 14, padding: 4 },
  routeInfo:   { padding: P },
  routeName:   { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  routeLocation: { fontSize: 11, fontWeight: '400', color: colors.textMuted, marginBottom: 7 },
  routeMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  metaChip:    { backgroundColor: colors.bgDeep, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  metaChipText:{ fontSize: 10, fontWeight: '400', color: colors.textMid },
  chevron:     { position: 'absolute', right: 14, top: 120, fontSize: 20, fontWeight: '300', color: colors.textFaint },

  emptyTitle:  { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptySub:    { fontSize: 13, fontWeight: '400', color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  planBtn:     { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  planBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  // Detail view
  metaStrip:      { flexDirection: 'row', marginHorizontal: P, marginVertical: 8, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  metaCell:       { flex: 1, paddingVertical: 9, alignItems: 'center' },
  metaCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  metaCellLabel:  { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  metaCellValue:  { fontSize: 11, fontWeight: '500', color: colors.text, textTransform: 'capitalize' },

  driveBadge:     { marginHorizontal: P, marginBottom: 6, backgroundColor: colors.bgDeep, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  driveBadgeText: { fontSize: 12, fontWeight: '400', color: colors.textMid },

  gpxBadge:       { marginHorizontal: P, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  gpxBadgeText:   { fontSize: 10, fontWeight: '500', color: colors.primary },

  sectionLabel:   { fontSize: 9, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginHorizontal: P, marginBottom: 6, marginTop: 4 },

  // Date strip
  dateStrip:      { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingBottom: 10 },
  dateChip:       { alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minWidth: 46 },
  dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDayName:    { fontSize: 9, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  dateDayNameActive: { color: 'rgba(255,255,255,0.75)' },
  dateDayNum:     { fontSize: 15, fontWeight: '500', color: colors.text, lineHeight: 18 },
  dateDayNumActive:  { color: '#fff' },
  weatherDot:     { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  weatherDotHas:  { backgroundColor: colors.primary },
  weatherDotActive: { backgroundColor: 'rgba(255,255,255,0.6)' },
  weatherDotNone: { backgroundColor: colors.borderLight },

  loadingBox:  { marginHorizontal: P, padding: 16, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, marginBottom: 8 },
  loadingText: { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center' },
  descCard:    { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, padding: 12 },
  descText:    { fontSize: 12, fontWeight: '300', color: colors.textMid, lineHeight: 18 },
  chipsWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: P, marginBottom: 8 },
  chip:        { backgroundColor: colors.bgDeep, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  chipText:    { fontSize: 10, fontWeight: '400', color: colors.textMid },
});
