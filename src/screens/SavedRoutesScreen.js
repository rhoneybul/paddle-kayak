import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Alert, ScrollView, RefreshControl, Platform, ActivityIndicator, Linking, Image, Animated, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { getSavedRoutes, deleteSavedRoute, saveRoute, updateRouteWaypoints, updateRouteLocalKnowledge, updateRouteLkMessages } from '../services/storageService';
import { getWeatherWithCache } from '../services/weatherService';
import { fetchTides, buildTideHeightMap, buildTideExtremeMap } from '../services/tideService';
import { generateLocalKnowledge, askLocalKnowledge } from '../services/claudeService';
import { fetchRoutePhotos } from '../services/photoService';
import PaddleMap from '../components/PaddleMap';
import ConditionsTimeline from '../components/ConditionsTimeline';
import { gpxRouteBearing } from '../components/PaddleMap';
import { HeartIcon } from '../components/UI';
import { HomeIcon, TrashIcon, PencilIcon } from '../components/Icons';

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

export default function SavedRoutesScreen({ navigation, route: navRoute }) {
  const previewRoute = navRoute?.params?.previewRoute ?? null;

  const [routes, setRoutes]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState(null);
  const [isUnsaved, setIsUnsaved]         = useState(false); // true when selected came from previewRoute and isn't saved yet
  const [viewDate, setViewDate]           = useState(getTodayString());
  const [weather, setWeather]             = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [tideHeightMap, setTideHeightMap]   = useState({});
  const [tideExtremeMap, setTideExtremeMap] = useState({});
  const [refreshing, setRefreshing]       = useState(false);

  const [editingName, setEditingName]     = useState(false);
  const [nameInput, setNameInput]         = useState('');
  const [drawMode, setDrawMode]           = useState(false);
  const [drawnPoints, setDrawnPoints]     = useState([]);
  const [mapExpanded, setMapExpanded]     = useState(false);
  const { height: screenHeight }          = useWindowDimensions();
  const mapHeightAnim                     = useRef(new Animated.Value(280)).current;
  const [saving, setSaving]               = useState(false);
  const [localKnowledge, setLocalKnowledge] = useState(null);
  const [genKnowledge, setGenKnowledge]     = useState(false);
  const [lkExpanded, setLkExpanded]         = useState(false);
  const [lkMessages, setLkMessages]         = useState([]);
  const [lkQuestion, setLkQuestion]         = useState('');
  const [lkAsking, setLkAsking]             = useState(false);
  const [photos, setPhotos]                 = useState([]);
  const [photosLoading, setPhotosLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const saved = await getSavedRoutes();
      setRoutes(saved);
      // If navigated with a previewRoute, find the saved version or show as unsaved
      if (previewRoute) {
        const match = saved.find(r => r.name === previewRoute.name);
        if (match) {
          setSelected(match);
          setIsUnsaved(false);
        } else {
          setSelected({ ...previewRoute, id: `preview-${Date.now()}` });
          setIsUnsaved(true);
        }
      }
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ticket 5: Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { setRoutes(await getSavedRoutes()); }
    finally { setRefreshing(false); }
  }, []);

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

  // Fetch tides once weather is loaded (need utcOffsetSeconds to align keys)
  useEffect(() => {
    if (!selected?.locationCoords || !weather) { setTideHeightMap({}); setTideExtremeMap({}); return; }
    const offset = weather.utcOffsetSeconds ?? 0;
    let cancelled = false;
    (async () => {
      const data = await fetchTides(selected.locationCoords.lat, selected.locationCoords.lng);
      if (!cancelled && data) {
        setTideHeightMap(buildTideHeightMap(data.heights, offset));
        setTideExtremeMap(buildTideExtremeMap(data.extremes, offset));
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, weather?.utcOffsetSeconds]);

  // Fetch nearby location photos when selected route changes
  useEffect(() => {
    if (!selected) { setPhotos([]); return; }
    let cancelled = false;
    (async () => {
      setPhotosLoading(true);
      try {
        const pics = await fetchRoutePhotos(selected);
        if (!cancelled) setPhotos(pics);
      } catch { if (!cancelled) setPhotos([]); }
      finally  { if (!cancelled) setPhotosLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const handleDelete = (id) => {
    const doDelete = async () => {
      await deleteSavedRoute(id);
      await load();
      if (selected?.id === id) setSelected(null);
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Remove this route from your saved routes?')) doDelete();
    } else {
      Alert.alert('Delete Route', 'Remove this route from your saved routes?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const drawnDistKm = drawnPoints.length >= 2
    ? drawnPoints.reduce((acc, pt, i) => {
        if (i === 0) return 0;
        const a = drawnPoints[i - 1], b = pt;
        const R = 6371;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLon = (b.lon - a.lon) * Math.PI / 180;
        const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
        return acc + R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
      }, 0)
    : 0;
  const drawnTimeHrs = drawnDistKm / 4;

  const handleFinishDraw = async () => {
    if (drawnPoints.length < 2) return;
    try {
      const waypoints = drawnPoints.map(p => [p.lat, p.lon]);
      const distanceKm = parseFloat(drawnDistKm.toFixed(1));
      const estimated_duration = parseFloat(drawnTimeHrs.toFixed(1));
      await updateRouteWaypoints(selected.id, { waypoints, distanceKm, estimated_duration });
      const fresh = await getSavedRoutes();
      setRoutes(fresh);
      setSelected(fresh.find(r => r.id === selected.id) || { ...selected, waypoints, distanceKm, estimated_duration });
      setDrawnPoints([]);
      setDrawMode(false);
    } catch {
      Alert.alert('Error', 'Could not save edited route — please try again.');
    }
  };

  const handleRename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === selected.name) { setEditingName(false); return; }
    try {
      const renamed = { ...selected, name: trimmed };
      await deleteSavedRoute(selected.id);
      await saveRoute(renamed, trimmed);
      const fresh = await getSavedRoutes();
      setRoutes(fresh);
      setSelected(fresh.find(r => r.name === trimmed) || renamed);
    } catch { Alert.alert('Error', 'Could not rename — please try again.'); }
    setEditingName(false);
  };

  // Load saved local knowledge when switching routes
  useEffect(() => {
    const saved = selected?.localKnowledge || null;
    setLocalKnowledge(saved);
    setLkExpanded(false);
    setLkMessages(selected?.lkMessages || []);
    setLkQuestion('');
    setMapExpanded(false);
    Animated.timing(mapHeightAnim, { toValue: 280, duration: 0, useNativeDriver: false }).start();
  }, [selected?.id]);

  const handleNavigateToStart = () => {
    // Prefer first waypoint coordinates, fall back to launch point name
    const firstWaypoint = Array.isArray(selected.waypoints) && selected.waypoints[0];
    let destination;
    if (firstWaypoint) {
      const lat = Array.isArray(firstWaypoint) ? firstWaypoint[0] : firstWaypoint.lat;
      const lon = Array.isArray(firstWaypoint) ? firstWaypoint[1] : firstWaypoint.lon;
      destination = `${lat},${lon}`;
    } else if (selected.launchPoint) {
      destination = encodeURIComponent(selected.launchPoint);
    } else {
      Alert.alert('No location', 'This route has no launch point set.');
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Could not open Google Maps.')
    );
  };

  const handleGenerateKnowledge = async () => {
    if (!selected || genKnowledge) return;
    setGenKnowledge(true);
    try {
      const data = await generateLocalKnowledge(selected);
      setLocalKnowledge(data);
      setLkExpanded(true);
      // Persist to the saved route (best-effort — preview routes won't have a real id)
      if (!isUnsaved) {
        await updateRouteLocalKnowledge(selected.id, data);
        setSelected(prev => ({ ...prev, localKnowledge: data }));
      }
    } catch {
      Alert.alert('Error', 'Could not generate local knowledge — please try again.');
    } finally {
      setGenKnowledge(false);
    }
  };

  const handleAskKnowledge = async () => {
    const q = lkQuestion.trim();
    if (!q || lkAsking || !localKnowledge) return;
    setLkQuestion('');
    setLkMessages(prev => [...prev, { role: 'user', text: q }]);
    setLkAsking(true);
    try {
      const answer = await askLocalKnowledge({ question: q, localKnowledge, route: selected });
      const updated = [...lkMessages, { role: 'user', text: q }, { role: 'assistant', text: answer }];
      setLkMessages(updated);
      if (!isUnsaved && selected?.id) {
        updateRouteLkMessages(selected.id, updated);
        setSelected(prev => ({ ...prev, lkMessages: updated }));
      }
    } catch {
      setLkMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, could not get an answer right now.' }]);
    } finally {
      setLkAsking(false);
    }
  };

  const handleSavePreview = async () => {
    if (!selected || !isUnsaved) return;
    setSaving(true);
    try {
      await saveRoute(selected, selected.name);
      const fresh = await getSavedRoutes();
      setRoutes(fresh);
      const match = fresh.find(r => r.name === selected.name);
      if (match) setSelected(match);
      setIsUnsaved(false);
    } catch {
      Alert.alert('Error', 'Could not save route — please try again.');
    } finally {
      setSaving(false);
    }
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
            {editingName && !isUnsaved ? (
              <TextInput
                style={s.navTitleInput}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleRename}
                onBlur={handleRename}
                selectTextOnFocus
              />
            ) : isUnsaved ? (
              <Text style={[s.navTitle, { marginLeft: 4 }]} numberOfLines={1}>{selected.name}</Text>
            ) : (
              <TouchableOpacity
                style={s.navTitleBtn}
                onPress={() => { setNameInput(selected.name); setEditingName(true); }}
                activeOpacity={0.7}
              >
                <Text style={s.navTitle} numberOfLines={1}>{selected.name}</Text>
                <PencilIcon size={12} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {!isUnsaved && (
              <TouchableOpacity onPress={() => handleDelete(selected.id)} style={s.deleteBtn}>
                <TrashIcon size={22} color={colors.warn} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.homeBtn}>
              <HomeIcon size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <Animated.View style={{ height: mapHeightAnim, overflow: 'hidden' }}>
            <PaddleMap
              height={drawMode ? Math.round(screenHeight * 0.6) : mapExpanded ? Math.round(screenHeight * 0.5) : 280}
              coords={selected.locationCoords
                ? { lat: selected.locationCoords.lat, lon: selected.locationCoords.lng }
                : undefined}
              routes={[selected]}
              selectedIdx={0}
              drawMode={drawMode}
              drawnPoints={drawnPoints}
              onAddPoint={pt => setDrawnPoints(prev => [...prev, pt])}
              onMovePoint={(idx, pt) => setDrawnPoints(prev => prev.map((p, i) => i === idx ? pt : p))}
              windHourly={weather?.hourly || []}
              windDate={viewDate}
              tideHeightMap={tideHeightMap}
              tideExtremeMap={tideExtremeMap}
              simpleRoute
            />
          </Animated.View>

          {/* Draw / edit controls */}
          <View style={s.drawBar}>
            {/* Expand map — only shown when not in draw mode */}
            {!drawMode && (
              <TouchableOpacity
                style={s.mapExpandBtn}
                onPress={() => {
                  const expanded = !mapExpanded;
                  setMapExpanded(expanded);
                  Animated.timing(mapHeightAnim, {
                    toValue: expanded ? Math.round(screenHeight * 0.5) : 280,
                    duration: 250,
                    useNativeDriver: false,
                  }).start();
                }}
                activeOpacity={0.75}
              >
                <Text style={s.mapExpandBtnText}>{mapExpanded ? '↑ Map' : '↓ Map'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.drawToggle, drawMode && s.drawToggleActive]}
              onPress={() => {
                if (!drawMode) {
                  const pts = (selected.waypoints || [])
                    .map(w => Array.isArray(w) ? { lat: w[0], lon: w[1] } : w)
                    .filter(p => p?.lat != null && p?.lon != null);
                  setDrawnPoints(pts);
                } else {
                  setDrawnPoints([]);
                }
                setDrawMode(d => !d);
              }}
              activeOpacity={0.85}
            >
              <Text style={[s.drawToggleText, drawMode && s.drawToggleTextActive]}>
                {drawMode ? 'Drawing…' : 'Edit route'}
              </Text>
            </TouchableOpacity>

            {drawMode && (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {drawnPoints.length > 0 && (
                  <>
                    <View style={s.drawStat}>
                      <Text style={s.drawStatVal}>{drawnDistKm.toFixed(1)} km</Text>
                      <Text style={s.drawStatLabel}>distance</Text>
                    </View>
                    <View style={s.drawStat}>
                      <Text style={s.drawStatVal}>
                        {drawnTimeHrs < 1 ? `${Math.round(drawnTimeHrs * 60)} min` : `${drawnTimeHrs.toFixed(1)} h`}
                      </Text>
                      <Text style={s.drawStatLabel}>~time</Text>
                    </View>
                    <TouchableOpacity style={s.drawAction} onPress={() => setDrawnPoints(p => p.slice(0, -1))} activeOpacity={0.7}>
                      <Text style={s.drawActionText}>Undo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.drawAction} onPress={() => setDrawnPoints(p => [...p, p[0]])} activeOpacity={0.7}>
                      <Text style={s.drawActionText}>Loop</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={s.drawClear} onPress={() => setDrawnPoints([])} activeOpacity={0.7}>
                  <Text style={s.drawClearText}>Clear all</Text>
                </TouchableOpacity>
              </View>
            )}

            {drawMode && drawnPoints.length >= 2 && (
              <TouchableOpacity style={s.drawFinish} onPress={handleFinishDraw} activeOpacity={0.85}>
                <Text style={s.drawFinishText}>Finish</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Scrollable content */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
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

            {/* Photo strip */}
            {(photosLoading || photos.length > 0) && (
              <View style={s.photoSection}>
                <Text style={s.sectionLabel}>PHOTOS</Text>
                {photosLoading ? (
                  <View style={s.photoLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.photoStrip}
                  >
                    {photos.map((photo, i) => (
                      <View key={i} style={s.photoCard}>
                        <Image
                          source={{ uri: photo.url }}
                          style={s.photoImage}
                          resizeMode="cover"
                        />
                        <Text style={s.photoCaption} numberOfLines={2}>{photo.title}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            {/* Save route (only shown for unsaved previews) */}
            {isUnsaved && (
              <TouchableOpacity
                style={s.goBtn}
                onPress={handleSavePreview}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.goBtnText}>Save route</Text>
                }
              </TouchableOpacity>
            )}

            {/* GPX download badge */}
            {selected.gpxUrl && (
              <View style={s.gpxBadge}>
                <Text style={s.gpxBadgeText}>GPX saved to cloud</Text>
              </View>
            )}

            {/* Navigate to start */}
            {(selected.launchPoint || (Array.isArray(selected.waypoints) && selected.waypoints.length > 0)) && (
              <TouchableOpacity style={s.navToStartBtn} onPress={handleNavigateToStart} activeOpacity={0.85}>
                <Text style={s.navToStartText}>Navigate to start</Text>
                {selected.launchPoint ? <Text style={s.navToStartSub}>{selected.launchPoint}</Text> : null}
              </TouchableOpacity>
            )}

            {/* Local Knowledge */}
            {!localKnowledge ? (
              genKnowledge ? (
                <View style={s.lkLoadingCard}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={s.lkLoadingTitle}>Consulting local knowledge…</Text>
                  <Text style={s.lkLoadingSubtitle}>Researching tides, currents, hazards and conditions for this area. This usually takes 20–40 seconds.</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.localKnowledgeBtn}
                  onPress={handleGenerateKnowledge}
                  activeOpacity={0.85}
                >
                  <Text style={s.localKnowledgeBtnText}>Generate local knowledge</Text>
                </TouchableOpacity>
              )
            ) : (
              <View style={s.localKnowledgeCard}>
                {/* Header row — tap to expand/collapse */}
                <TouchableOpacity
                  style={s.lkHeader}
                  onPress={() => setLkExpanded(e => !e)}
                  activeOpacity={0.7}
                >
                  <Text style={s.localKnowledgeTitle}>Local Knowledge</Text>
                  <Text style={s.lkChevron}>{lkExpanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {lkExpanded && (
                  <>
                    {localKnowledge.summary ? (
                      <Text style={s.localKnowledgeSummary}>{localKnowledge.summary}</Text>
                    ) : null}

                    {/* Tides */}
                    {localKnowledge.tides && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Tides</Text>
                        {localKnowledge.tides.pattern    ? <Text style={s.lkText}>{localKnowledge.tides.pattern}</Text> : null}
                        {localKnowledge.tides.key_times  ? <Text style={s.lkText}>{localKnowledge.tides.key_times}</Text> : null}
                        {localKnowledge.tides.cautions   ? <Text style={[s.lkText, s.lkCaution]}>{localKnowledge.tides.cautions}</Text> : null}
                      </View>
                    )}

                    {/* Currents */}
                    {localKnowledge.currents && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Currents</Text>
                        {localKnowledge.currents.main_flows ? <Text style={s.lkText}>{localKnowledge.currents.main_flows}</Text> : null}
                        {localKnowledge.currents.races      ? <Text style={s.lkText}>{localKnowledge.currents.races}</Text> : null}
                        {localKnowledge.currents.cautions   ? <Text style={[s.lkText, s.lkCaution]}>{localKnowledge.currents.cautions}</Text> : null}
                      </View>
                    )}

                    {/* Winds */}
                    {localKnowledge.winds && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Winds</Text>
                        {localKnowledge.winds.prevailing    ? <Text style={s.lkText}>{localKnowledge.winds.prevailing}</Text> : null}
                        {localKnowledge.winds.local_effects ? <Text style={s.lkText}>{localKnowledge.winds.local_effects}</Text> : null}
                        {localKnowledge.winds.cautions      ? <Text style={[s.lkText, s.lkCaution]}>{localKnowledge.winds.cautions}</Text> : null}
                      </View>
                    )}

                    {/* Waves */}
                    {localKnowledge.waves && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Waves</Text>
                        {localKnowledge.waves.typical         ? <Text style={s.lkText}>{localKnowledge.waves.typical}</Text> : null}
                        {localKnowledge.waves.swell_exposure  ? <Text style={s.lkText}>Swell: {localKnowledge.waves.swell_exposure}</Text> : null}
                      </View>
                    )}

                    {/* Hazards */}
                    {localKnowledge.hazards?.length > 0 && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Hazards</Text>
                        {localKnowledge.hazards.map((h, i) => (
                          <Text key={i} style={[s.lkText, s.lkCaution]}>• {h}</Text>
                        ))}
                      </View>
                    )}

                    {/* Emergency */}
                    {localKnowledge.emergency && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Emergency</Text>
                        {localKnowledge.emergency.coastguard  ? <Text style={s.lkText}>Coastguard: {localKnowledge.emergency.coastguard}</Text> : null}
                        {localKnowledge.emergency.rnli        ? <Text style={s.lkText}>RNLI: {localKnowledge.emergency.rnli}</Text> : null}
                        {localKnowledge.emergency.vhf_channel ? <Text style={s.lkText}>VHF Ch{localKnowledge.emergency.vhf_channel}</Text> : null}
                      </View>
                    )}

                    {/* Navigation Rules */}
                    {localKnowledge.navigation_rules && Object.values(localKnowledge.navigation_rules).some(v => v != null) && (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Navigation Rules</Text>
                        {localKnowledge.navigation_rules.shipping_lanes   && <Text style={[s.lkText, s.lkCaution]}>Shipping lanes: {localKnowledge.navigation_rules.shipping_lanes}</Text>}
                        {localKnowledge.navigation_rules.restricted_areas && <Text style={[s.lkText, s.lkCaution]}>Restricted areas: {localKnowledge.navigation_rules.restricted_areas}</Text>}
                        {localKnowledge.navigation_rules.right_of_way     && <Text style={s.lkText}>Right of way: {localKnowledge.navigation_rules.right_of_way}</Text>}
                        {localKnowledge.navigation_rules.vhf_working      && <Text style={s.lkText}>VHF: {localKnowledge.navigation_rules.vhf_working}</Text>}
                        {localKnowledge.navigation_rules.speed_limits     && <Text style={s.lkText}>Speed limits: {localKnowledge.navigation_rules.speed_limits}</Text>}
                        {localKnowledge.navigation_rules.notices          && <Text style={s.lkText}>Notices: {localKnowledge.navigation_rules.notices}</Text>}
                      </View>
                    )}

                    {/* Wildlife */}
                    {localKnowledge.wildlife ? (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Wildlife</Text>
                        <Text style={s.lkText}>{localKnowledge.wildlife}</Text>
                      </View>
                    ) : null}

                    {/* Recommended skills */}
                    {localKnowledge.recommended_skills ? (
                      <View style={s.lkSection}>
                        <Text style={s.lkSectionTitle}>Recommended Skills</Text>
                        <Text style={s.lkText}>{localKnowledge.recommended_skills}</Text>
                      </View>
                    ) : null}

                    {/* Q&A */}
                    <View style={s.lkQA}>
                      {lkMessages.length > 0 && (
                        <View style={s.lkMessages}>
                          {lkMessages.map((msg, i) => (
                            <View key={i} style={[s.lkMsg, msg.role === 'user' ? s.lkMsgUser : s.lkMsgAssistant]}>
                              <Text style={msg.role === 'user' ? s.lkMsgUserText : s.lkMsgAssistantText}>{msg.text}</Text>
                            </View>
                          ))}
                          {lkAsking && (
                            <View style={s.lkMsgAssistant}>
                              <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                          )}
                        </View>
                      )}
                      <View style={s.lkInputRow}>
                        <TextInput
                          style={s.lkInput}
                          value={lkQuestion}
                          onChangeText={setLkQuestion}
                          placeholder="Ask a question about this route…"
                          placeholderTextColor={colors.textMuted}
                          returnKeyType="send"
                          onSubmitEditing={handleAskKnowledge}
                          editable={!lkAsking}
                        />
                        <TouchableOpacity
                          style={[s.lkSendBtn, (!lkQuestion.trim() || lkAsking) && s.lkSendBtnDisabled]}
                          onPress={handleAskKnowledge}
                          activeOpacity={0.7}
                          disabled={!lkQuestion.trim() || lkAsking}
                        >
                          <Text style={s.lkSendText}>↑</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <TouchableOpacity onPress={() => { setLocalKnowledge(null); setLkExpanded(false); setLkMessages([]); setLkQuestion(''); }} style={s.lkRefreshBtn}>
                      <Text style={s.lkRefreshText}>Regenerate</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

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
                startHour={9}
                routeBearing={routeBearing}
                tideHeightMap={tideHeightMap}
                tideExtremeMap={tideExtremeMap}
              />
            ) : null}

            <View style={{ height: 32 }} />
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
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.homeBtn}>
            <HomeIcon size={22} color={colors.primary} />
          </TouchableOpacity>
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
                    simpleRoute
                    staticView
                  />
                  <View style={s.heartOverlay}>
                    <HeartIcon filled size={20} color={colors.warn} />
                  </View>
                </View>
                {/* Route info */}
                <View style={s.routeInfo}>
                  <View style={s.routeNameRow}>
                    <Text style={s.routeName} numberOfLines={1}>{r.name}</Text>
                    <TouchableOpacity
                      style={s.listDeleteBtn}
                      onPress={() => handleDelete(r.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <TrashIcon size={16} color={colors.warn} />
                    </TouchableOpacity>
                  </View>
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
  navTitleBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 4 },
  navTitleInput: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4, paddingVertical: 2, paddingHorizontal: 4, borderBottomWidth: 1.5, borderBottomColor: colors.primary },
  goBtn:         { marginHorizontal: 14, marginBottom: 10, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  goBtnText:     { fontSize: 15, fontWeight: '600', color: '#fff' },
  deleteBtn:     { paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  homeBtn:       { paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },

  // List
  list:        { padding: P, gap: 10 },
  routeCard:   { backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  mapThumb:    { overflow: 'hidden', position: 'relative' },
  heartOverlay:{ position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 12, padding: 4 },
  routeInfo:   { padding: P },
  routeNameRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  routeName:     { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  listDeleteBtn: { padding: 4, marginLeft: 8 },
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

  gpxBadge:       { marginHorizontal: P, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  gpxBadgeText:   { fontSize: 10, fontWeight: '500', color: colors.primary },

  navToStartBtn:  { marginHorizontal: P, marginTop: 4, marginBottom: 8, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  navToStartText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  navToStartSub:  { fontSize: 11, fontWeight: '300', color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  sectionLabel:   { fontSize: 9, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginHorizontal: P, marginBottom: 6, marginTop: 4 },

  // Photo strip
  photoSection:   { marginTop: 6, marginBottom: 4 },
  photoLoading:   { height: 130, alignItems: 'center', justifyContent: 'center' },
  photoStrip:     { paddingHorizontal: P, gap: 8, paddingBottom: 4 },
  photoCard:      { width: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.borderLight },
  photoImage:     { width: 160, height: 110 },
  photoCaption:   { fontSize: 9, fontWeight: '400', color: colors.textMuted, paddingHorizontal: 6, paddingVertical: 5, lineHeight: 13 },

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

  mapExpandBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  mapExpandBtnText:   { fontSize: 11, fontWeight: '500', color: colors.primary },
  drawBar:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, gap: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.white },
  drawToggle:         { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  drawToggleActive:   { backgroundColor: colors.primary },
  drawToggleText:     { fontSize: 11, fontWeight: '500', color: colors.primary },
  drawToggleTextActive:{ color: '#fff' },
  drawStat:           { alignItems: 'center', paddingHorizontal: 4 },
  drawStatVal:        { fontSize: 12, fontWeight: '600', color: colors.text },
  drawStatLabel:      { fontSize: 9, fontWeight: '400', color: colors.textMuted },
  drawAction:         { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  drawActionText:     { fontSize: 11, fontWeight: '400', color: colors.textMid },
  drawClear:          { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.warn + '88' },
  drawClearText:      { fontSize: 11, fontWeight: '400', color: colors.warn },
  drawFinish:         { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary },
  drawFinishText:     { fontSize: 11, fontWeight: '600', color: '#fff' },

  localKnowledgeBtn:     { marginHorizontal: P, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  localKnowledgeBtnText: { fontSize: 13, fontWeight: '500', color: colors.primary },
  lkLoadingCard:         { marginHorizontal: P, marginTop: 4, marginBottom: 8, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.borderLight, padding: 16, alignItems: 'center', gap: 8 },
  lkLoadingTitle:        { fontSize: 13, fontWeight: '500', color: colors.text, marginTop: 4 },
  lkLoadingSubtitle:     { fontSize: 12, fontWeight: '300', color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
  localKnowledgeCard:    { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.borderLight, padding: 14 },
  lkHeader:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  localKnowledgeTitle:   { fontSize: 13, fontWeight: '600', color: colors.text },
  lkChevron:             { fontSize: 10, color: colors.textMuted },
  localKnowledgeSummary: { fontSize: 12, fontWeight: '300', color: colors.textMid, lineHeight: 18, marginTop: 8, marginBottom: 10 },
  lkSection:             { marginBottom: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  lkSectionTitle:        { fontSize: 9, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  lkText:                { fontSize: 11, fontWeight: '300', color: colors.textMid, lineHeight: 16, marginBottom: 3 },
  lkCaution:             { color: colors.warn + 'cc' },
  lkRefreshBtn:          { marginTop: 10, alignItems: 'center', paddingVertical: 6 },
  lkRefreshText:         { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  lkQA:                  { marginTop: 12, borderTopWidth: 0.5, borderTopColor: colors.borderLight, paddingTop: 10 },
  lkMessages:            { gap: 6, marginBottom: 8 },
  lkMsg:                 { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, maxWidth: '90%' },
  lkMsgUser:             { alignSelf: 'flex-end', backgroundColor: colors.primary },
  lkMsgAssistant:        { alignSelf: 'flex-start', backgroundColor: colors.bgDeep },
  lkMsgUserText:         { fontSize: 12, fontWeight: '400', color: '#fff', lineHeight: 17 },
  lkMsgAssistantText:    { fontSize: 12, fontWeight: '300', color: colors.text, lineHeight: 17 },
  lkInputRow:            { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lkInput:               { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: '300', color: colors.text, backgroundColor: colors.white },
  lkSendBtn:             { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  lkSendBtnDisabled:     { backgroundColor: colors.textFaint },
  lkSendText:            { fontSize: 16, color: '#fff', lineHeight: 18 },


});
