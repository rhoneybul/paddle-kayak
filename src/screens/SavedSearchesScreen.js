import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fontFamily } from '../theme';
import { getSavedSearches, deleteSavedSearch } from '../services/storageService';
import { getSearches, subscribe, cancelSearch, deleteSearch } from '../services/searchManager';

function formatSavedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function SavedSearchesScreen({ navigation }) {
  const [searches, setSearches] = useState([]);
  const [bgSearches, setBgSearches] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await getSavedSearches();
      setSearches(data);
      const active = await getSearches();
      setBgSearches(active);
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Subscribe to background search updates
  useEffect(() => {
    const unsub = subscribe((updated) => setBgSearches(updated));
    return unsub;
  }, []);

  const handleDelete = (id, location) => {
    const doDelete = async () => {
      await deleteSavedSearch(id);
      setSearches(prev => prev.filter(s => s.id !== id));
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove search for "${location}"?`)) doDelete();
    } else {
      Alert.alert('Remove search', `Remove search for "${location}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const handleOpen = (search) => {
    navigation.navigate('Planner', { savedSearch: search });
  };

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>{'\u2039'}</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Saved Searches</Text>
        </View>

        {searches.length === 0 && bgSearches.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No saved searches</Text>
            <Text style={s.emptyBody}>
              After planning a paddle, tap Save in the results screen to keep a search for later.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            {/* In-progress background searches */}
            {bgSearches.filter(s => s.status === 'pending').map((bs) => (
              <View key={bs.id} style={[s.card, s.cardPending]}>
                <View style={s.cardMain}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={s.cardLocation} numberOfLines={1}>{bs.params?.destination || 'Searching…'}</Text>
                    </View>
                    <Text style={s.cardMeta}>Search in progress…</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => cancelSearch(bs.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.deleteBtnText}>{'\u00D7'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {/* Completed background searches */}
            {bgSearches.filter(s => s.status === 'complete' && s.plan).map((bs) => (
              <TouchableOpacity
                key={bs.id}
                style={[s.card, s.cardComplete]}
                onPress={() => {
                  navigation.navigate('Planner', {
                    savedSearch: {
                      location: bs.params?.destination || '',
                      locationCoords: bs.params?.location || null,
                      minDurationHrs: bs.params?.minDurationHrs,
                      maxDurationHrs: bs.params?.maxDurationHrs,
                      plan: bs.plan,
                    },
                  });
                  deleteSearch(bs.id);
                }}
                activeOpacity={0.85}
              >
                <View style={s.cardMain}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardLocation} numberOfLines={1}>{bs.params?.destination || 'Search'}</Text>
                    <Text style={s.cardMeta}>
                      {bs.plan?.routes?.length || 0} routes found  ·  Tap to view
                    </Text>
                  </View>
                  <View style={s.newBadge}><Text style={s.newBadgeText}>New</Text></View>
                </View>
              </TouchableOpacity>
            ))}
            {/* Saved searches */}
            {searches.map((search) => {
              const routeCount = search.plan?.routes?.length || 0;
              const dur = search.minDurationHrs === search.maxDurationHrs
                ? `${search.minDurationHrs}h`
                : `${search.minDurationHrs}–${search.maxDurationHrs}h`;
              return (
                <TouchableOpacity
                  key={search.id}
                  style={s.card}
                  onPress={() => handleOpen(search)}
                  activeOpacity={0.85}
                >
                  <View style={s.cardMain}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardLocation} numberOfLines={1}>{search.location || 'Unknown location'}</Text>
                      <Text style={s.cardMeta}>
                        {[
                          `${dur} paddle`,
                          routeCount > 0 ? `${routeCount} route${routeCount !== 1 ? 's' : ''}` : null,
                          formatSavedAt(search.savedAt),
                        ].filter(Boolean).join('  ·  ')}
                      </Text>
                      {search.plan?.routes?.length > 0 && (
                        <View style={s.routePreviewRow}>
                          {search.plan.routes.slice(0, 3).map((r, i) => (
                            <View key={i} style={s.routePill}>
                              <Text style={s.routePillText} numberOfLines={1}>{r.name}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={s.deleteBtn}
                      onPress={() => handleDelete(search.id, search.location)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={s.deleteBtnText}>{'\u00D7'}</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 48 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const P = 20;
const FF = fontFamily;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  nav:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:  { fontSize: 24, color: colors.primary },
  navTitle:  { flex: 1, fontSize: 17, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginLeft: 4 },
  scroll:    { flex: 1 },
  scrollContent: { paddingTop: 8, paddingBottom: 24 },
  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle:{ fontSize: 17, fontWeight: '500', fontFamily: FF.medium, color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 15, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  card:      { marginHorizontal: 20, marginBottom: 8, backgroundColor: colors.white, borderRadius: 18, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  cardMain:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardLocation: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginBottom: 3 },
  cardMeta:  { fontSize: 12, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, marginBottom: 6 },
  routePreviewRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  routePill: { backgroundColor: colors.bgDeep, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  routePillText: { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  deleteBtn: { paddingTop: 2 },
  deleteBtnText: { fontSize: 20, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, lineHeight: 22 },
  cardPending:  { borderWidth: 1.5, borderColor: colors.primary + '40' },
  cardComplete: { borderWidth: 1.5, borderColor: colors.primary },
  newBadge:     { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { fontSize: 10, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
});
