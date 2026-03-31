import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Alert, ScrollView, RefreshControl, Platform, Linking, ActivityIndicator, Image, Animated, useWindowDimensions, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily } from '../theme';
import { getSavedRoutes, getSavedRoutesLocal, deleteSavedRoute, saveRoute, updateRouteWaypoints, updateRouteLocalKnowledge, updateRouteLkMessages, updateRoutePhotos, getCollections, createCollection, deleteCollection, addRouteToCollection, removeRouteFromCollection } from '../services/storageService';
import { getWeatherWithCache } from '../services/weatherService';
import { fetchTides, buildTideHeightMap, buildTideExtremeMap } from '../services/tideService';
import { generateLocalKnowledge, askLocalKnowledge } from '../services/claudeService';
import { fetchWaypointPhotos } from '../services/photoService';
import api from '../services/api';
import PaddleMap from '../components/PaddleMap';
import ConditionsTimeline from '../components/ConditionsTimeline';
import { gpxRouteBearing } from '../components/PaddleMap';
import { HeartIcon } from '../components/UI';
import { BackIcon, HomeIcon, TrashIcon, PencilIcon, CompassIcon, FolderIcon, SearchIcon } from '../components/Icons';
import { searchLocations, MIN_SEARCH_LENGTH, SEARCH_DEBOUNCE_MS } from '../services/geocodingService';

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
  const drawNew      = navRoute?.params?.drawNew ?? false;

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
  const [waypointPhotos, setWaypointPhotos] = useState([]); // [{ label, photos }]
  const [photosLoading, setPhotosLoading]   = useState(false);
  const [campsites, setCampsites]           = useState([]);

  // Collections
  const [collections, setCollections]       = useState([]);
  const [activeTab, setActiveTab]           = useState('routes'); // 'routes' | 'collections'
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showNewCollection, setShowNewCollection]   = useState(false);
  const [newCollectionName, setNewCollectionName]   = useState('');
  const [showAddToCollection, setShowAddToCollection] = useState(false);

  // POI search
  const [pois, setPois]                     = useState([]);
  const [poisLoading, setPoisLoading]       = useState(false);
  const [poiType, setPoiType]               = useState(null); // currently selected POI type

  // Location search (for new drawn routes)
  const [locSearch, setLocSearch]               = useState('');
  const [locSearchResults, setLocSearchResults] = useState([]);
  const [locSearchLoading, setLocSearchLoading] = useState(false);
  const [showLocSearch, setShowLocSearch]       = useState(false);
  const locSearchTimer                          = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const saved = await getSavedRoutes();
      setRoutes(saved);
      // Load collections
      const cols = await getCollections();
      setCollections(cols);
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

  // Handle "Draw a route" entry — create blank route in draw mode
  useEffect(() => {
    if (!drawNew) return;
    // Show the map immediately with no coords — GPS will update it
    const blankRoute = {
      id: `draw-${Date.now()}`,
      name: 'New Route',
      waypoints: [],
      distanceKm: 0,
      estimated_duration: 0,
      isDrawn: true,
      locationCoords: null,
      description: '',
      highlights: [],
      terrain: 'coastal',
      difficulty: 'moderate',
    };
    setSelected(blankRoute);
    setIsUnsaved(true);
    setDrawMode(true);
    setShowLocSearch(true);
    setMapExpanded(true);
    Animated.timing(mapHeightAnim, {
      toValue: Math.round(screenHeight * 0.6),
      duration: 0,
      useNativeDriver: false,
    }).start();

    // Fetch GPS in background and update when available
    (async () => {
      try {
        const { default: Location } = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: 3 /* Balanced */ });
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setSelected(prev => prev && !prev.locationCoords ? { ...prev, locationCoords: coords } : prev);
        }
      } catch { /* ignore */ }
    })();
  }, [drawNew]);

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

  // Fetch per-waypoint photos + campsites when selected route changes
  useEffect(() => {
    if (!selected) { setWaypointPhotos([]); setCampsites([]); return; }
    // Don't fetch photos until the route has a location and waypoints
    if (!selected.locationCoords && (!selected.waypoints || selected.waypoints.length === 0)) {
      setWaypointPhotos([]); setCampsites([]); return;
    }
    let cancelled = false;

    // Photos: use cached if available, otherwise fetch and cache
    (async () => {
      if (selected.cachedPhotos && selected.cachedPhotos.length > 0) {
        if (!cancelled) setWaypointPhotos(selected.cachedPhotos);
        return;
      }
      setPhotosLoading(true);
      try {
        const groups = await fetchWaypointPhotos(selected);
        if (!cancelled) {
          setWaypointPhotos(groups);
          // Cache the photos on the saved route
          if (groups.length > 0 && !isUnsaved && selected.id) {
            await updateRoutePhotos(selected.id, groups);
            setSelected(prev => ({ ...prev, cachedPhotos: groups }));
          }
        }
      } catch { if (!cancelled) setWaypointPhotos([]); }
      finally  { if (!cancelled) setPhotosLoading(false); }
    })();

    // Campsites near route
    if (selected.locationCoords) {
      api.campsites.search(selected.locationCoords.lat, selected.locationCoords.lng, 30)
        .then(data => { if (!cancelled) setCampsites(data || []); })
        .catch(() => {});
    }

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
      const updated = { ...selected, waypoints, distanceKm, estimated_duration, isDrawn: true };

      if (isUnsaved) {
        await saveRoute(updated, updated.name);
        setIsUnsaved(false);
      } else {
        await updateRouteWaypoints(selected.id, { waypoints, distanceKm, estimated_duration, isDrawn: true });
      }

      // Update selected immediately with in-memory data — don't wait on cache read
      setSelected(updated);
      setDrawnPoints([]);
      setDrawMode(false);
      // Refresh route list in background
      getSavedRoutesLocal().then(fresh => setRoutes(fresh)).catch(() => {});
    } catch (err) {
      console.error('[handleFinishDraw]', err);
      Alert.alert('Error', `Could not save: ${err?.message || err}`);
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

  // Load saved local knowledge + reset draw state when switching routes
  useEffect(() => {
    const saved = selected?.localKnowledge || null;
    setLocalKnowledge(saved);
    setLkExpanded(false);
    setLkMessages(selected?.lkMessages || []);
    setLkQuestion('');

    // Don't reset draw mode / map if this is a fresh drawNew route
    const isDrawNew = selected?.id?.startsWith('draw-');
    if (!isDrawNew) {
      setMapExpanded(false);
      Animated.timing(mapHeightAnim, { toValue: 280, duration: 0, useNativeDriver: false }).start();
      setDrawnPoints([]);
      setDrawMode(false);
      setShowLocSearch(false);
    }
  }, [selected?.id]);


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
            <TouchableOpacity onPress={() => previewRoute ? navigation.goBack() : setSelected(null)} style={s.navIconBtn}>
              <BackIcon size={20} color={colors.primary} />
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
            ) : (
              <Text style={s.navTitle} numberOfLines={1}>{selected.name}</Text>
            )}
            <View style={s.navActions}>
              {!isUnsaved && collections.length > 0 && (
                <TouchableOpacity onPress={() => setShowAddToCollection(true)} style={s.navIconBtn}>
                  <FolderIcon size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
              {!isUnsaved && (
                <TouchableOpacity onPress={() => { setNameInput(selected.name); setEditingName(true); }} style={s.navIconBtn}>
                  <PencilIcon size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {!isUnsaved && (
                <TouchableOpacity onPress={() => handleDelete(selected.id)} style={s.navIconBtn}>
                  <TrashIcon size={20} color={colors.warn} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.navIconBtn}>
                <HomeIcon size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Location search bar — shown when drawing a new route */}
          {showLocSearch && drawMode && (
            <View style={s.locSearchWrap}>
              <View style={s.locSearchRow}>
                <SearchIcon size={16} color={colors.textMuted} />
                <TextInput
                  style={s.locSearchInput}
                  value={locSearch}
                  onChangeText={(text) => {
                    setLocSearch(text);
                    if (locSearchTimer.current) clearTimeout(locSearchTimer.current);
                    if (text.trim().length < MIN_SEARCH_LENGTH) {
                      setLocSearchResults([]); return;
                    }
                    locSearchTimer.current = setTimeout(async () => {
                      setLocSearchLoading(true);
                      try {
                        const results = await searchLocations(text);
                        setLocSearchResults(results);
                      } catch { setLocSearchResults([]); }
                      finally { setLocSearchLoading(false); }
                    }, SEARCH_DEBOUNCE_MS);
                  }}
                  placeholder="Search for a location…"
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="search"
                />
                {locSearchLoading && <ActivityIndicator size="small" color={colors.primary} />}
                {locSearch.length > 0 && (
                  <TouchableOpacity onPress={() => { setLocSearch(''); setLocSearchResults([]); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              {locSearchResults.length > 0 && (
                <View style={s.locSearchResults}>
                  {locSearchResults.map((result, i) => (
                    <TouchableOpacity
                      key={`${result.lat}-${result.lng}-${i}`}
                      style={[s.locSearchResultItem, i < locSearchResults.length - 1 && s.locSearchResultBorder]}
                      onPress={() => {
                        const coords = { lat: result.lat, lng: result.lng };
                        setSelected(prev => ({ ...prev, locationCoords: coords, location: result.label }));
                        setLocSearch(result.label);
                        setLocSearchResults([]);
                        setShowLocSearch(false);
                        Keyboard.dismiss();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={s.locSearchResultLabel} numberOfLines={1}>{result.label}</Text>
                      <Text style={s.locSearchResultCoords}>{result.lat.toFixed(3)}, {result.lng.toFixed(3)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

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
              campsites={campsites}
            />
            {drawMode && drawnPoints.length > 0 && (
              <View style={s.drawStatsOverlay} pointerEvents="none">
                <Text style={s.drawStatsText}>
                  {drawnDistKm.toFixed(1)} km{'  ·  '}
                  {drawnTimeHrs < 1 ? `~${Math.round(drawnTimeHrs * 60)} min` : `~${drawnTimeHrs.toFixed(1)} h`}
                </Text>
              </View>
            )}
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
            {!drawMode ? (
              <TouchableOpacity
                style={s.drawToggle}
                onPress={() => {
                  const raw = Array.isArray(selected.waypoints) ? selected.waypoints : [];
                  const pts = raw
                    .map(w => Array.isArray(w) ? { lat: w[0], lon: w[1] } : w)
                    .filter(p => p?.lat != null && p?.lon != null);
                  setDrawnPoints(pts);
                  setDrawMode(true);
                }}
                activeOpacity={0.85}
              >
                <Text style={s.drawToggleText}>
                  {selected.isDrawn ? 'Edit route' : 'Draw route'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {drawnPoints.length > 0 && (
                  <>
                    <TouchableOpacity style={s.drawAction} onPress={() => setDrawnPoints(p => p.slice(0, -1))} activeOpacity={0.7}>
                      <Text style={s.drawActionText}>Undo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.drawAction} onPress={() => setDrawnPoints(p => [...p, p[0]])} activeOpacity={0.7}>
                      <Text style={s.drawActionText}>Loop</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={s.drawClear}
                  onPress={() => {
                    const doClear = async () => {
                      setDrawnPoints([]);
                      // Also clear the saved route's waypoints so the route resets fully
                      if (selected && !isUnsaved) {
                        await updateRouteWaypoints(selected.id, { waypoints: [], distanceKm: 0, estimated_duration: 0, isDrawn: false });
                        const updated = { ...selected, waypoints: [], distanceKm: 0, estimated_duration: 0, isDrawn: false };
                        setSelected(updated);
                        getSavedRoutesLocal().then(fresh => setRoutes(fresh)).catch(() => {});
                      } else if (selected) {
                        setSelected({ ...selected, waypoints: [], distanceKm: 0, estimated_duration: 0, isDrawn: false });
                      }
                    };
                    if (Platform.OS === 'web') {
                      if (window.confirm('Clear all points and reset the route?')) doClear();
                    } else {
                      Alert.alert('Clear Route', 'Clear all points and reset the route?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Clear', style: 'destructive', onPress: doClear },
                      ]);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={s.drawClearText}>Clear all</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={s.drawAction} onPress={() => { setDrawnPoints([]); setDrawMode(false); }} activeOpacity={0.7}>
                  <Text style={s.drawActionText}>Cancel</Text>
                </TouchableOpacity>
                {drawnPoints.length >= 2 && (
                  <TouchableOpacity style={s.drawFinish} onPress={handleFinishDraw} activeOpacity={0.85}>
                    <Text style={s.drawFinishText}>Finish</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* POI search chips */}
          {!drawMode && selected.locationCoords && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.poiChipStrip}>
              {[
                { key: 'cafe', label: 'Coffee' },
                { key: 'pub', label: 'Pubs' },
                { key: 'campsite', label: 'Campsites' },
                { key: 'restaurant', label: 'Restaurants' },
                { key: 'slipway', label: 'Slipways' },
                { key: 'parking', label: 'Parking' },
                { key: 'toilet', label: 'Toilets' },
              ].map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[s.poiChip, poiType === key && s.poiChipActive]}
                  onPress={async () => {
                    if (poiType === key) { setPoiType(null); setPois([]); return; }
                    setPoiType(key);
                    setPoisLoading(true);
                    try {
                      const data = await api.pois.search(
                        selected.locationCoords.lat,
                        selected.locationCoords.lng,
                        10, key,
                      );
                      setPois(Array.isArray(data) ? data : []);
                    } catch { setPois([]); }
                    finally { setPoisLoading(false); }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.poiChipText, poiType === key && s.poiChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {poisLoading && (
            <View style={{ paddingVertical: 6, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}
          {pois.length > 0 && !poisLoading && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.poiResultStrip}>
              {pois.map((poi, i) => (
                <View key={poi.id || i} style={s.poiCard}>
                  <Text style={s.poiName} numberOfLines={1}>{poi.name || 'Unnamed'}</Text>
                  <Text style={s.poiType}>{poi.type}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Scrollable content */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
            {/* Stats strip */}
            <View style={s.metaStrip}>
              {[
                ['Distance', selected.distanceKm ? `${selected.distanceKm} km` : '—'],
                ['Duration', `~${selected.estimated_duration}h`],
                ['Terrain',  selected.terrain  || '—'],
              ].map(([l, v], i) => (
                <View key={l} style={[s.metaCell, s.metaCellBorder]}>
                  <Text style={s.metaCellLabel}>{l}</Text>
                  <Text style={s.metaCellValue}>{v}</Text>
                </View>
              ))}
              {/* Risk flag cell */}
              {(() => {
                const hazards = localKnowledge?.hazards;
                const highDiff = selected.difficulty === 'advanced' || selected.difficulty === 'expert';
                const hasRisk = (hazards && hazards.length > 0) || highDiff;
                return (
                  <View style={s.metaCell}>
                    <Text style={s.metaCellLabel}>Risks</Text>
                    <Text style={[s.metaCellValue, hasRisk ? s.metaCellRisk : s.metaCellSafe]}>
                      {hasRisk ? '⚑ Flagged' : 'None'}
                    </Text>
                  </View>
                );
              })()}
            </View>

            {/* Per-waypoint photos */}
            {photosLoading && (
              <View style={s.photoLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
            {waypointPhotos.map((group, gi) => (
              <View key={gi} style={s.photoSection}>
                <Text style={s.sectionLabel}>{group.label.toUpperCase()}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoStrip}>
                  {group.photos.map((photo, i) => (
                    <View key={i} style={s.photoCard}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => photo.commonsUrl && Linking.openURL(photo.commonsUrl)}
                      >
                        <Image source={{ uri: photo.url }} style={s.photoImage} resizeMode="cover" />
                        <Text style={s.photoCaption} numberOfLines={2}>{photo.title}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.photoRemoveBtn}
                        onPress={() => {
                          const updated = waypointPhotos.map((g, gIdx) => gIdx === gi
                            ? { ...g, photos: g.photos.filter((_, pIdx) => pIdx !== i) }
                            : g
                          ).filter(g => g.photos.length > 0);
                          setWaypointPhotos(updated);
                          if (!isUnsaved && selected?.id) {
                            updateRoutePhotos(selected.id, updated);
                            setSelected(prev => ({ ...prev, cachedPhotos: updated }));
                          }
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={s.photoRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ))}
            {/* Photo actions: load / refresh / add more */}
            {!photosLoading && selected && (
              <View style={s.photoActions}>
                <TouchableOpacity
                  style={s.generatePhotosBtn}
                  onPress={async () => {
                    setPhotosLoading(true);
                    try {
                      const groups = await fetchWaypointPhotos(selected);
                      if (groups.length > 0) {
                        setWaypointPhotos(groups);
                        if (!isUnsaved && selected.id) {
                          await updateRoutePhotos(selected.id, groups);
                          setSelected(prev => ({ ...prev, cachedPhotos: groups }));
                        }
                      }
                    } catch { /* ignore */ }
                    finally { setPhotosLoading(false); }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={s.generatePhotosBtnText}>
                    {waypointPhotos.length > 0 ? 'Refresh photos' : 'Load photos'}
                  </Text>
                </TouchableOpacity>
                {waypointPhotos.length > 0 && (
                  <TouchableOpacity
                    style={s.generatePhotosBtn}
                    onPress={async () => {
                      setPhotosLoading(true);
                      try {
                        const newGroups = await fetchWaypointPhotos(selected);
                        if (newGroups.length > 0) {
                          // Merge: deduplicate by URL, append new photos
                          const existingUrls = new Set(waypointPhotos.flatMap(g => g.photos.map(p => p.url)));
                          const merged = waypointPhotos.map(g => ({ ...g }));
                          for (const ng of newGroups) {
                            const newPhotos = ng.photos.filter(p => !existingUrls.has(p.url));
                            if (newPhotos.length > 0) {
                              const existing = merged.find(g => g.label === ng.label);
                              if (existing) {
                                existing.photos = [...existing.photos, ...newPhotos];
                              } else {
                                merged.push({ ...ng, photos: newPhotos });
                              }
                            }
                          }
                          setWaypointPhotos(merged);
                          if (!isUnsaved && selected.id) {
                            await updateRoutePhotos(selected.id, merged);
                            setSelected(prev => ({ ...prev, cachedPhotos: merged }));
                          }
                        }
                      } catch { /* ignore */ }
                      finally { setPhotosLoading(false); }
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.generatePhotosBtnText}>Add more photos</Text>
                  </TouchableOpacity>
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

            {/* Start Paddle on Route */}
            <TouchableOpacity
              style={s.startRouteBtn}
              onPress={() => navigation.navigate('ActivePaddle', { mode: 'route', savedRoute: selected })}
              activeOpacity={0.85}
            >
              <Text style={s.startRouteBtnText}>▶  Start Paddle on Route</Text>
            </TouchableOpacity>

            {/* GPX download badge */}
            {selected.gpxUrl && (
              <View style={s.gpxBadge}>
                <Text style={s.gpxBadgeText}>GPX saved to cloud</Text>
              </View>
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
                  <View style={s.lkHeaderLeft}>
                    <CompassIcon size={15} color={colors.primary} strokeWidth={1.8} />
                    <Text style={s.localKnowledgeTitle}>Local Knowledge</Text>
                  </View>
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

          {/* Add to collection modal */}
          {showAddToCollection && (
            <View style={s.collectionModal}>
              <View style={s.collectionModalCard}>
                <Text style={s.collectionModalTitle}>Add to collection</Text>
                {collections.map(col => (
                  <TouchableOpacity
                    key={col.id}
                    style={s.collectionModalRow}
                    onPress={() => handleAddToCollection(col.id)}
                    activeOpacity={0.7}
                  >
                    <FolderIcon size={16} color={colors.primary} />
                    <Text style={s.collectionModalRowText}>{col.name}</Text>
                    {col.routeIds.includes(selected?.id) && (
                      <Text style={s.collectionModalCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={s.collectionModalCancel}
                  onPress={() => setShowAddToCollection(false)}
                  activeOpacity={0.7}
                >
                  <Text style={s.collectionModalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    );
  }

  // ── Collections helper ────────────────────────────────────────────────────
  const filteredRoutes = selectedCollection
    ? routes.filter(r => selectedCollection.routeIds.includes(r.id))
    : routes;

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const col = await createCollection(name);
    setCollections(prev => [col, ...prev]);
    setNewCollectionName('');
    setShowNewCollection(false);
  };

  const handleDeleteCollection = (col) => {
    const doDelete = async () => {
      await deleteCollection(col.id);
      setCollections(prev => prev.filter(c => c.id !== col.id));
      if (selectedCollection?.id === col.id) setSelectedCollection(null);
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete collection "${col.name}"?`)) doDelete();
    } else {
      Alert.alert('Delete Collection', `Delete "${col.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const handleAddToCollection = async (colId) => {
    if (!selected) return;
    await addRouteToCollection(colId, selected.id);
    const fresh = await getCollections();
    setCollections(fresh);
    setShowAddToCollection(false);
  };

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.navIconBtn}>
            <BackIcon size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={s.navTitle}>Saved Paddles</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.navIconBtn}>
            <HomeIcon size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Tab bar: Routes | Collections */}
        <View style={s.tabBar}>
          <TouchableOpacity
            style={[s.tab, activeTab === 'routes' && s.tabActive]}
            onPress={() => { setActiveTab('routes'); setSelectedCollection(null); }}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, activeTab === 'routes' && s.tabTextActive]}>Routes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, activeTab === 'collections' && s.tabActive]}
            onPress={() => setActiveTab('collections')}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, activeTab === 'collections' && s.tabTextActive]}>Collections</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>Loading…</Text>
          </View>
        ) : activeTab === 'collections' ? (
          /* ── Collections tab ─────────────────────────────────────────── */
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.list}>
            <TouchableOpacity
              style={s.newCollectionBtn}
              onPress={() => setShowNewCollection(true)}
              activeOpacity={0.7}
            >
              <Text style={s.newCollectionBtnText}>+ New Collection</Text>
            </TouchableOpacity>
            {showNewCollection && (
              <View style={s.newCollectionRow}>
                <TextInput
                  style={s.newCollectionInput}
                  value={newCollectionName}
                  onChangeText={setNewCollectionName}
                  placeholder="Collection name…"
                  placeholderTextColor={colors.textFaint}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleCreateCollection}
                />
                <TouchableOpacity style={s.newCollectionSave} onPress={handleCreateCollection} activeOpacity={0.7}>
                  <Text style={s.newCollectionSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            )}
            {collections.length === 0 && !showNewCollection && (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Text style={s.emptyTitle}>No collections</Text>
                <Text style={s.emptySub}>Create a collection to group your saved routes</Text>
              </View>
            )}
            {collections.map(col => (
              <TouchableOpacity
                key={col.id}
                style={s.collectionCard}
                onPress={() => { setSelectedCollection(col); setActiveTab('routes'); }}
                activeOpacity={0.85}
              >
                <FolderIcon size={20} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.collectionName}>{col.name}</Text>
                  <Text style={s.collectionMeta}>{col.routeIds.length} route{col.routeIds.length !== 1 ? 's' : ''}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteCollection(col)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <TrashIcon size={15} color={colors.warn} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : filteredRoutes.length === 0 && !selectedCollection ? (
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
        ) : filteredRoutes.length === 0 && selectedCollection ? (
          <View style={s.centered}>
            <Text style={s.emptyTitle}>{selectedCollection.name}</Text>
            <Text style={s.emptySub}>No routes in this collection yet. Add routes from their detail view.</Text>
            <TouchableOpacity style={s.planBtn} onPress={() => setSelectedCollection(null)} activeOpacity={0.85}>
              <Text style={s.planBtnText}>View all routes</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
          {selectedCollection && (
            <View style={s.collectionHeader}>
              <TouchableOpacity onPress={() => setSelectedCollection(null)} activeOpacity={0.7}>
                <Text style={s.collectionBackText}>← All routes</Text>
              </TouchableOpacity>
              <Text style={s.collectionHeaderTitle}>{selectedCollection.name}</Text>
            </View>
          )}
          <FlatList
            data={filteredRoutes}
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
                  <View style={s.savedBadge}>
                    <Text style={s.savedBadgeText}>Saved</Text>
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
              </TouchableOpacity>
            )}
          />
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const P = 20;
const FF = fontFamily;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },

  nav:           { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  navIconBtn:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle:      { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginHorizontal: 4 },
  navTitleBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 4 },
  navTitleInput: { flex: 1, fontSize: 14, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginHorizontal: 4, paddingVertical: 2, paddingHorizontal: 4, borderBottomWidth: 1.5, borderBottomColor: colors.primary },
  navActions:    { flexDirection: 'row', alignItems: 'center' },
  goBtn:         { marginHorizontal: P, marginBottom: 10, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4 },
  goBtnText:     { fontSize: 16, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
  startRouteBtn:     { marginHorizontal: P, marginBottom: 10, backgroundColor: colors.white, borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.primary },
  startRouteBtnText: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary },

  // List
  list:        { padding: P, gap: 14 },
  routeCard:   { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', shadowColor: '#1a1d26', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 3 },
  mapThumb:    { overflow: 'hidden', position: 'relative' },
  savedBadge:    { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(74,108,247,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  savedBadgeText:{ fontSize: 11, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary },
  routeInfo:   { padding: 16, paddingBottom: 14 },
  routeNameRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  routeName:     { fontSize: 16, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, flex: 1 },
  listDeleteBtn: { padding: 4, marginLeft: 8 },
  routeLocation: { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginBottom: 8 },
  routeMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip:    { backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  metaChipText:{ fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.blue700 },

  emptyTitle:  { fontSize: 18, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginBottom: 8 },
  emptySub:    { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  planBtn:     { backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4 },
  planBtnText: { fontSize: 16, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  // Detail view
  metaStrip:      { flexDirection: 'row', marginHorizontal: P, marginVertical: 8, backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', shadowColor: '#1a1d26', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  metaCell:       { flex: 1, paddingVertical: 10, alignItems: 'center' },
  metaCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  metaCellLabel:  { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  metaCellValue:  { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.text, textTransform: 'capitalize' },
  metaCellRisk:   { color: colors.warn },
  metaCellSafe:   { color: colors.primary },

  gpxBadge:       { marginHorizontal: P, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  gpxBadgeText:   { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },

  sectionLabel:   { fontSize: 10, fontWeight: '600', fontFamily: FF.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginHorizontal: P, marginBottom: 6, marginTop: 4 },

  // Photo strip
  photoSection:   { marginTop: 6, marginBottom: 4 },
  photoLoading:   { height: 130, alignItems: 'center', justifyContent: 'center' },
  photoStrip:     { paddingHorizontal: P, gap: 8, paddingBottom: 4 },
  photoCard:      { width: 160, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.white },
  photoImage:     { width: 160, height: 110 },
  photoCaption:   { fontSize: 9, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, paddingHorizontal: 6, paddingTop: 5, lineHeight: 13 },
  photoLink:      { fontSize: 8, fontWeight: '500', fontFamily: FF.medium, color: colors.primary, paddingHorizontal: 6, paddingBottom: 6, paddingTop: 2 },
  photoRemoveBtn:  { paddingHorizontal: 6, paddingVertical: 4 },
  photoRemoveText: { fontSize: 8, fontWeight: '500', fontFamily: FF.medium, color: colors.warn },
  photoActions:          { flexDirection: 'row', gap: 8, marginHorizontal: P, marginBottom: 8 },
  generatePhotosBtn:     { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  generatePhotosBtnText: { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },

  // Date strip
  dateStrip:      { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingBottom: 10 },
  dateChip:       { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.white, minWidth: 48 },
  dateChipActive: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  dateDayName:    { fontSize: 9, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  dateDayNameActive: { color: 'rgba(255,255,255,0.8)' },
  dateDayNum:     { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, lineHeight: 18 },
  dateDayNumActive:  { color: '#fff' },
  weatherDot:     { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  weatherDotHas:  { backgroundColor: colors.accent },
  weatherDotActive: { backgroundColor: 'rgba(255,255,255,0.6)' },
  weatherDotNone: { backgroundColor: colors.borderLight },

  loadingBox:  { marginHorizontal: P, padding: 16, backgroundColor: colors.white, borderRadius: 18, marginBottom: 8 },
  loadingText: { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center' },
  descCard:    { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 18, padding: 16 },
  descText:    { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid, lineHeight: 21 },
  chipsWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: P, marginBottom: 8 },
  chip:        { backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  chipText:    { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.blue600 },

  mapExpandBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  mapExpandBtnText:   { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  drawBar:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.white },
  drawToggle:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
  drawToggleActive:   { backgroundColor: colors.primary },
  drawToggleText:     { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  drawToggleTextActive:{ color: '#fff' },
  drawStatsOverlay:   { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
  drawStatsText:      { backgroundColor: 'rgba(26,29,38,0.55)', color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, overflow: 'hidden', letterSpacing: 0.2 },
  drawStat:           { alignItems: 'center', paddingHorizontal: 4 },
  drawStatVal:        { fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  drawStatLabel:      { fontSize: 9, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted },
  drawAction:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  drawActionText:     { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.textMid },
  drawClear:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.warn + '88' },
  drawClearText:      { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.warn },
  drawFinish:         { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  drawFinishText:     { fontSize: 11, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  localKnowledgeBtn:     { marginHorizontal: P, marginTop: 4, marginBottom: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  localKnowledgeBtnText: { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  lkLoadingCard:         { marginHorizontal: P, marginTop: 4, marginBottom: 8, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight, padding: 18, alignItems: 'center', gap: 8 },
  lkLoadingTitle:        { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.text, marginTop: 4 },
  lkLoadingSubtitle:     { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
  localKnowledgeCard:    { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 18, padding: 18 },
  lkHeader:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lkHeaderLeft:          { flexDirection: 'row', alignItems: 'center', gap: 7 },
  localKnowledgeTitle:   { fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  lkChevron:             { fontSize: 9, color: colors.textMuted },
  localKnowledgeSummary: { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid, lineHeight: 19, marginTop: 8, marginBottom: 10 },
  lkSection:             { marginBottom: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  lkSectionTitle:        { fontSize: 8.5, fontWeight: '600', fontFamily: FF.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  lkText:                { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid, lineHeight: 17, marginBottom: 3 },
  lkCaution:             { color: colors.warn + 'cc' },
  lkRefreshBtn:          { marginTop: 10, alignItems: 'center', paddingVertical: 6 },
  lkRefreshText:         { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted },
  lkQA:                  { marginTop: 12, borderTopWidth: 0.5, borderTopColor: colors.borderLight, paddingTop: 10 },
  lkMessages:            { gap: 6, marginBottom: 8 },
  lkMsg:                 { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '90%' },
  lkMsgUser:             { alignSelf: 'flex-end', backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 2 },
  lkMsgAssistant:        { alignSelf: 'flex-start', backgroundColor: colors.primaryLight },
  lkMsgUserText:         { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: '#fff', lineHeight: 17 },
  lkMsgAssistantText:    { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.text, lineHeight: 17 },
  lkInputRow:            { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lkInput:               { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.text, backgroundColor: colors.white },
  lkSendBtn:             { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 2 },
  lkSendBtnDisabled:     { backgroundColor: colors.textFaint },
  lkSendText:            { fontSize: 16, color: '#fff', lineHeight: 18 },

  // Tab bar
  tabBar:             { flexDirection: 'row', marginHorizontal: P, marginTop: 8, backgroundColor: '#e1e0db', borderRadius: 10, padding: 2, gap: 2 },
  tab:                { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
  tabActive:          { backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  tabText:            { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted },
  tabTextActive:      { fontWeight: '600', fontFamily: FF.semibold, color: colors.text },

  // Collections
  collectionCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 18, padding: 16, marginBottom: 8, shadowColor: '#1a1d26', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3 },
  collectionName:     { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  collectionMeta:     { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },
  collectionHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: P, paddingVertical: 8 },
  collectionBackText: { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  collectionHeaderTitle: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  newCollectionBtn:      { marginBottom: 10, paddingVertical: 12, alignItems: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed' },
  newCollectionBtnText:  { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  newCollectionRow:      { flexDirection: 'row', gap: 8, marginBottom: 10 },
  newCollectionInput:    { flex: 1, backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: FF.regular, color: colors.text, borderWidth: 1, borderColor: colors.border },
  newCollectionSave:     { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' },
  newCollectionSaveText: { fontSize: 13, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  // Collection modal
  collectionModal:         { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', zIndex: 10 },
  collectionModalCard:     { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: P, paddingBottom: 40 },
  collectionModalTitle:    { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginBottom: 12 },
  collectionModalRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  collectionModalRowText:  { flex: 1, fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.text },
  collectionModalCheck:    { fontSize: 14, fontWeight: '600', color: colors.primary },
  collectionModalCancel:   { marginTop: 14, paddingVertical: 12, alignItems: 'center' },
  collectionModalCancelText: { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted },

  // Location search
  locSearchWrap:        { paddingHorizontal: P, paddingVertical: 6, backgroundColor: colors.white, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  locSearchRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  locSearchInput:       { flex: 1, fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.text, padding: 0 },
  locSearchResults:     { marginTop: 6, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  locSearchResultItem:  { paddingHorizontal: 14, paddingVertical: 10 },
  locSearchResultBorder:{ borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  locSearchResultLabel: { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  locSearchResultCoords:{ fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, marginTop: 1 },

  // POI search
  poiChipStrip:     { paddingHorizontal: P, gap: 6, paddingVertical: 6 },
  poiChip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  poiChipActive:    { backgroundColor: colors.primary, borderColor: colors.primary },
  poiChipText:      { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.textMid },
  poiChipTextActive:{ color: '#fff' },
  poiResultStrip:   { paddingHorizontal: P, gap: 6, paddingBottom: 6 },
  poiCard:          { backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minWidth: 100 },
  poiName:          { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  poiType:          { fontSize: 10, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },
});
