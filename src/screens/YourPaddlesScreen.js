import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import {
  isStravaConfigured, getStravaTokens, connectStrava,
  fetchStravaActivities, getStravaAthlete,
} from '../services/stravaService';

// Activity types considered paddle sports
const PADDLE_TYPES = new Set([
  'Kayaking', 'Canoeing', 'Rowing', 'StandUpPaddling',
  'Surfing', 'Sailing', 'Windsurf', 'Kitesurfing',
]);

function formatDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatDistance(meters) {
  if (!meters) return '—';
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatSpeed(metersPerSecond) {
  if (!metersPerSecond) return null;
  // Convert m/s to knots (1 m/s ≈ 1.944 knots)
  const knots = metersPerSecond * 1.944;
  return `${knots.toFixed(1)} kt`;
}

// ── Locked overlay shown when Strava not connected ────────────────────────────

function LockedState({ onConnect, connecting, error, configured }) {
  return (
    <View style={s.lockedWrap}>
      {/* Ghost activity cards behind the blur */}
      {[1, 2, 3].map(i => (
        <View key={i} style={[s.ghostCard, { opacity: 0.25 - i * 0.06 }]}>
          <View style={s.ghostTitle} />
          <View style={s.ghostMeta} />
          <View style={[s.ghostMeta, { width: '45%' }]} />
        </View>
      ))}

      {/* Lock panel */}
      <View style={s.lockPanel}>
        <View style={s.lockIcon}>
          <Text style={s.lockIconText}>⚑</Text>
        </View>
        <Text style={s.lockTitle}>Your Paddles</Text>
        <Text style={s.lockBody}>
          Connect Strava to see all your kayaking, canoeing, and paddling sessions here.
        </Text>

        {!configured ? (
          <View style={s.lockNote}>
            <Text style={s.lockNoteText}>
              Strava credentials aren't configured.{'\n'}Add EXPO_PUBLIC_STRAVA_CLIENT_ID and _SECRET to .env
            </Text>
          </View>
        ) : connecting ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : (
          <TouchableOpacity style={s.connectBtn} onPress={onConnect} activeOpacity={0.85}>
            <Text style={s.connectBtnText}>Connect Strava</Text>
          </TouchableOpacity>
        )}

        {error ? <Text style={s.lockError}>{error}</Text> : null}
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function YourPaddlesScreen({ navigation }) {
  const [connected, setConnected]     = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [connError, setConnError]     = useState(null);
  const [athlete, setAthlete]         = useState(null);
  const [activities, setActivities]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [showAll, setShowAll]         = useState(false);

  const checkAndLoad = useCallback(async () => {
    const tokens = await getStravaTokens();
    if (!tokens) { setConnected(false); return; }
    setConnected(true);

    setLoading(true);
    try {
      const [ath, acts] = await Promise.all([
        getStravaAthlete(),
        fetchStravaActivities(100),
      ]);
      setAthlete(ath);
      // Filter to paddle-sport activities only
      setActivities(acts.filter(a => PADDLE_TYPES.has(a.type)));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { checkAndLoad(); }, [checkAndLoad]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnError(null);
    try {
      await connectStrava();
      // On web, page reloads; on mobile we get here after auth
      await checkAndLoad();
    } catch (e) {
      setConnError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  // ── Not connected ───────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          <View style={s.nav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
              <Text style={s.backText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.navTitle}>Your Paddles</Text>
          </View>
          <LockedState
            configured={isStravaConfigured()}
            connecting={connecting}
            error={connError}
            onConnect={handleConnect}
          />
        </SafeAreaView>
      </View>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────────
  const displayedActivities = showAll ? activities : activities.slice(0, 20);

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Your Paddles</Text>
          {athlete ? (
            <Text style={s.navSub}>{athlete.firstname} {athlete.lastname}</Text>
          ) : null}
        </View>

        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={s.loadingText}>Loading activities…</Text>
          </View>
        ) : activities.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>No paddle activities yet</Text>
            <Text style={s.emptySub}>
              Kayaking, canoeing, rowing and paddle boarding activities from Strava will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayedActivities}
            keyExtractor={a => String(a.id)}
            contentContainerStyle={s.list}
            ListHeaderComponent={
              <Text style={s.countLabel}>
                {activities.length} paddle{activities.length !== 1 ? 's' : ''} recorded
              </Text>
            }
            ListFooterComponent={
              !showAll && activities.length > 20 ? (
                <TouchableOpacity style={s.showMoreBtn} onPress={() => setShowAll(true)}>
                  <Text style={s.showMoreText}>Show all {activities.length} paddles</Text>
                </TouchableOpacity>
              ) : <View style={{ height: 48 }} />
            }
            renderItem={({ item: a }) => {
              const speed = formatSpeed(a.average_speed);
              return (
                <View style={s.activityCard}>
                  {/* Type badge */}
                  <View style={s.cardTop}>
                    <View style={s.typeBadge}>
                      <Text style={s.typeText}>{a.type}</Text>
                    </View>
                    <Text style={s.dateText}>{formatDate(a.start_date_local)}</Text>
                  </View>

                  {/* Name */}
                  <Text style={s.activityName} numberOfLines={1}>{a.name}</Text>

                  {/* Stats row */}
                  <View style={s.statsRow}>
                    <View style={s.stat}>
                      <Text style={s.statLabel}>Distance</Text>
                      <Text style={s.statValue}>{formatDistance(a.distance)}</Text>
                    </View>
                    <View style={[s.stat, s.statBorder]}>
                      <Text style={s.statLabel}>Duration</Text>
                      <Text style={s.statValue}>{formatDuration(a.moving_time)}</Text>
                    </View>
                    {speed ? (
                      <View style={[s.stat, s.statBorder]}>
                        <Text style={s.statLabel}>Avg Speed</Text>
                        <Text style={s.statValue}>{speed}</Text>
                      </View>
                    ) : null}
                    {a.total_elevation_gain > 0 ? (
                      <View style={[s.stat, s.statBorder]}>
                        <Text style={s.statLabel}>Elevation</Text>
                        <Text style={s.statValue}>{Math.round(a.total_elevation_gain)} m</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const P = 14;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },

  nav:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.primary },
  navTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  navSub:   { fontSize: 11, fontWeight: '400', color: colors.textMuted },

  loadingText: { fontSize: 12, fontWeight: '300', color: colors.textMuted, marginTop: 12 },
  emptyTitle:  { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptySub:    { fontSize: 13, fontWeight: '300', color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  list:        { padding: P, gap: 10 },
  countLabel:  { fontSize: 10, fontWeight: '500', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },

  activityCard: {
    backgroundColor: colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borderLight,
    padding: 13, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  typeBadge:    { backgroundColor: colors.primaryLight, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:     { fontSize: 9.5, fontWeight: '600', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  dateText:     { fontSize: 10, fontWeight: '400', color: colors.textMuted },
  activityName: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 10 },
  statsRow:     { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colors.borderLight, paddingTop: 10 },
  stat:         { flex: 1, alignItems: 'center' },
  statBorder:   { borderLeftWidth: 0.5, borderLeftColor: colors.borderLight },
  statLabel:    { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  statValue:    { fontSize: 14, fontWeight: '500', color: colors.text },

  showMoreBtn:  { marginTop: 4, alignItems: 'center', paddingVertical: 14 },
  showMoreText: { fontSize: 13, fontWeight: '500', color: colors.primary },

  // Locked state
  lockedWrap:  { flex: 1, padding: P },
  ghostCard:   { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight, padding: 14, marginBottom: 10 },
  ghostTitle:  { height: 14, backgroundColor: colors.borderLight, borderRadius: 4, marginBottom: 8, width: '65%' },
  ghostMeta:   { height: 10, backgroundColor: colors.borderLight, borderRadius: 4, marginBottom: 6, width: '80%' },
  lockPanel: {
    position: 'absolute', bottom: 40, left: P, right: P,
    backgroundColor: colors.white, borderRadius: 20,
    borderWidth: 1, borderColor: colors.borderLight,
    padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1, shadowRadius: 20, elevation: 8,
  },
  lockIcon:     { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bgDeep, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  lockIconText: { fontSize: 22 },
  lockTitle:    { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8 },
  lockBody:     { fontSize: 13, fontWeight: '300', color: colors.textMuted, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  connectBtn:   { backgroundColor: '#FC4C02', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 13 },
  connectBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  lockNote:     { backgroundColor: colors.bgDeep, borderRadius: 8, padding: 12, marginTop: 4 },
  lockNoteText: { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
  lockError:    { fontSize: 11, fontWeight: '400', color: colors.warn, marginTop: 12, textAlign: 'center' },
});
