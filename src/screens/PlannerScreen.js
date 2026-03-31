import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { HomeIcon } from '../components/Icons';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Animated, Keyboard, Alert, Platform, Modal, RefreshControl, ActivityIndicator, Image,
  useWindowDimensions, KeyboardAvoidingView, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors, fontFamily } from '../theme';
import {
  SectionHeader, AlertBanner, ProgressBar,
  ErrorState, HeartIcon,
} from '../components/UI';
import PaddleMap from '../components/PaddleMap';
import ConditionsTimeline from '../components/ConditionsTimeline';
import { gpxRouteBearing } from '../components/PaddleMap';
import { planPaddleWithWeather, hasApiKey, refineRoute, askSafety } from '../services/claudeService';
import { SKILL_LEVELS, getStravaTokens, fetchStravaActivities, inferSkillFromStrava } from '../services/stravaService';
import { searchLocations, MIN_SEARCH_LENGTH, SEARCH_DEBOUNCE_MS } from '../services/geocodingService';
import { getWeatherWithCache } from '../services/weatherService';
import { fetchTides, buildTideHeightMap, buildTideExtremeMap } from '../services/tideService';
import { saveRoute, getSavedRoutes, deleteSavedRoute, saveSearch, deleteSavedSearch } from '../services/storageService';
import { startSearch as startBgSearch } from '../services/searchManager';
import { track } from '../services/analyticsService';
import {
  validateMaritimeRoute,
  normaliseWaypointCoords,
  getRouteLaunchPoint,
  buildNavigateToStartUrl,
} from '../services/routeService';

const MIN_HOURS_OPTIONS = [1, 2, 3, 4, 5, 6];
const MAX_HOURS_OPTIONS = [1, 2, 3, 4, 5, 6];
const MAX_TRAVEL_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr',   value: 60 },
  { label: '2 hr',   value: 120 },
  { label: 'Any',    value: 9999 },
];

// Results weather date strip: today through +7 days
const RESULTS_DATE_STRIP = (() => {
  const arr = [];
  const today = new Date();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return arr;
})();

const LOADING_MESSAGES = [
  'Analysing local waters...',
  'Checking weather conditions...',
  'Finding launch points...',
  'Building route options...',
  'Assessing safety...',
];

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isDateValid(dateStr) {
  if (!dateStr || dateStr.length !== 10) return false;
  // Parse date components
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;
  const parsed = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed >= today;
}

export function isDurationValid(duration) {
  return typeof duration === 'number' && duration > 0;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return 'No date';
  const today = getTodayString();
  if (dateStr === today) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (dateStr === tmStr) return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dateStringToDate(str) {
  if (!str) return new Date();
  return new Date(str + 'T12:00:00');
}

function dateToString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


export default function PlannerScreen({ navigation, route: navRoute }) {
  // Optional free-text nudge
  const [nudge, setNudge] = useState('');

  // Duration range
  const [minDurationHrs, setMinDurationHrs] = useState(2);
  const [maxDurationHrs, setMaxDurationHrs] = useState(4);
  const [maxTravelMins, setMaxTravelMins]   = useState(60);

  // Location
  const [destination, setDestination]       = useState('');
  const [locationCoords, setLocationCoords] = useState(null);
  const [searchResults, setSearchResults]   = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchLoading, setSearchLoading]   = useState(false);
  const searchTimerRef = useRef(null);

  // Weather
  const [weatherData, setWeatherData]     = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [tideHeightMap, setTideHeightMap]   = useState({});
  const [tideExtremeMap, setTideExtremeMap] = useState({});
  const [resultsDate, setResultsDate]     = useState(null); // date selected on results for weather

  const weatherDates = useMemo(() => {
    if (!weatherData?.hourly) return new Set();
    return new Set(weatherData.hourly.map(h => h.time?.slice(0, 10)).filter(Boolean));
  }, [weatherData]);

  // Strava skill inference
  const [skillLevel, setSkillLevel]       = useState(SKILL_LEVELS.INTERMEDIATE);
  const [previousPaddle, setPreviousPaddle] = useState(null);
  const [stravaLoaded, setStravaLoaded]   = useState(false);

  // Plan state
  const [, setPrompt]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [plan, setPlan]           = useState(null);
  const [planError, setPlanError] = useState(null); // Ticket 4: error state
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [expandedRoute, setExpandedRoute]       = useState(-1);
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const loadingMsgRef = useRef(null);
  const abortRef = useRef(null);
  const pendingSearchRef = useRef(null); // stores search params for retry after background

  // Keep search alive when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && pendingSearchRef.current && !loading && !plan && !planError) {
        // App returned from background and search may have been dropped — retry
        handleGenerate();
      }
    });
    return () => sub.remove();
  }, []);

  // Save modal state
  const [saveModalRoute, setSaveModalRoute] = useState(null); // route obj being saved
  const [saveNameInput, setSaveNameInput]   = useState('');
  const [saving, setSaving]                 = useState(false);

  const [editingRouteIdx, setEditingRouteIdx] = useState(-1);
  const [editText, setEditText]               = useState('');
  const [editLoading, setEditLoading]         = useState(false);

  // Favorites state (Ticket 3)
  const [savedRouteNames, setSavedRouteNames] = useState(new Set());

  // Pull to refresh (Ticket 5)
  const [refreshing, setRefreshing] = useState(false);

  const [drawMode, setDrawMode]         = useState(false);
  const [drawnPoints, setDrawnPoints]   = useState([]);
  const [searchSaved, setSearchSaved]   = useState(false);
  const [savedSearchId, setSavedSearchId] = useState(null);
  const [editingRouteName, setEditingRouteName] = useState(false);
  const [routeNameInput, setRouteNameInput]     = useState('');
  const { height: screenHeight }        = useWindowDimensions();
  const [mapExpanded, setMapExpanded] = useState(false);
  const mapHeightAnim = useRef(new Animated.Value(260)).current;

  useEffect(() => {
    const toValue = drawMode
      ? Math.round(screenHeight * 0.64)
      : mapExpanded
        ? Math.round(screenHeight * 0.52)
        : 310;
    Animated.spring(mapHeightAnim, {
      toValue,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start();
  }, [drawMode, mapExpanded]);

  // Ask AI
  const [askText, setAskText]           = useState('');
  const [askLoading, setAskLoading]     = useState(false);
  const [askAnswer, setAskAnswer]       = useState(null);

  // Refine search
  const [refineText, setRefineText]     = useState('');
  const [refineOpen, setRefineOpen]     = useState(false);

  // Restore a saved search if navigated from SavedSearchesScreen
  useEffect(() => {
    const saved = navRoute?.params?.savedSearch;
    if (!saved) return;
    setDestination(saved.location || '');
    setLocationCoords(saved.locationCoords || null);
    if (saved.minDurationHrs) setMinDurationHrs(saved.minDurationHrs);
    if (saved.maxDurationHrs) setMaxDurationHrs(saved.maxDurationHrs);
    if (saved.plan) {
      setPlan(saved.plan);
      setSearchSaved(true);
      fadeAnim.setValue(1);
    }
  }, [navRoute?.params?.savedSearch]);

  // Load saved routes to know which are favorited
  const loadSavedRouteNames = useCallback(async () => {
    try {
      const routes = await getSavedRoutes();
      setSavedRouteNames(new Set(routes.map(r => r.name)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSavedRouteNames(); }, [loadSavedRouteNames]);

  // GPS prefill
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude: lat, longitude: lon } = pos.coords;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
          { headers: { 'User-Agent': 'PaddleApp/1.0' } },
        );
        const data = await res.json();
        const label = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';
        if (label && !destination) {
          setDestination(label);
          setLocationCoords({ lat, lng: lon });
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Strava skill inference
  useEffect(() => {
    (async () => {
      try {
        const tokens = await getStravaTokens();
        if (!tokens) return;
        const activities = await fetchStravaActivities(50);
        if (activities.length > 0) {
          setSkillLevel(inferSkillFromStrava(activities));
          const paddleTypes = ['Kayaking', 'Canoeing', 'Rowing', 'StandUpPaddling', 'Surfing'];
          const last = activities.find(a => paddleTypes.includes(a.type));
          if (last) {
            setPreviousPaddle({
              name: last.name,
              distance: (last.distance / 1000).toFixed(1),
              date: new Date(last.start_date).toLocaleDateString(),
            });
          }
          setStravaLoaded(true);
        }
      } catch { /* Strava not available */ }
    })();
  }, []);

  // Fetch weather when location changes
  useEffect(() => {
    if (!locationCoords) { setWeatherData(null); return; }
    let cancelled = false;
    (async () => {
      setWeatherLoading(true);
      try {
        const weather = await getWeatherWithCache(locationCoords.lat, locationCoords.lng);
        if (!cancelled) setWeatherData(weather);
      } catch {
        if (!cancelled) setWeatherData(null);
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [locationCoords?.lat, locationCoords?.lng]);

  // Fetch tides once weather is loaded (need utcOffsetSeconds to align keys)
  useEffect(() => {
    if (!locationCoords || !weatherData) { setTideHeightMap({}); setTideExtremeMap({}); return; }
    const offset = weatherData.utcOffsetSeconds ?? 0;
    let cancelled = false;
    (async () => {
      const data = await fetchTides(locationCoords.lat, locationCoords.lng);
      if (!cancelled && data) {
        setTideHeightMap(buildTideHeightMap(data.heights, offset));
        setTideExtremeMap(buildTideExtremeMap(data.extremes, offset));
      }
    })();
    return () => { cancelled = true; };
  }, [locationCoords?.lat, locationCoords?.lng, weatherData?.utcOffsetSeconds]);

  // Debounced location search
  const handleDestinationChange = useCallback((text) => {
    setDestination(text);
    if (locationCoords) setLocationCoords(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < MIN_SEARCH_LENGTH) {
      setSearchResults([]); setShowSearchResults(false); return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchLocations(text);
        setSearchResults(results);
        setShowSearchResults(results.length > 0);
      } catch {
        setSearchResults([]); setShowSearchResults(false);
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, [locationCoords]);

  const selectSearchResult = useCallback((result) => {
    setDestination(result.label);
    setLocationCoords({ lat: result.lat, lng: result.lng });
    setSearchResults([]);
    setShowSearchResults(false);
    Keyboard.dismiss();
  }, []);

  const buildPrompt = () => {
    const travelLabel = MAX_TRAVEL_OPTIONS.find(o => o.value === maxTravelMins)?.label ?? 'any distance';
    const parts = [
      `I'm near ${destination}`,
      `I want to paddle for between ${minDurationHrs} and ${maxDurationHrs} hour${maxDurationHrs > 1 ? 's' : ''}`,
    ];
    if (maxTravelMins < 9999) parts.push(`I can travel up to ${travelLabel} to reach the launch point`);
    if (previousPaddle) parts.push(`My last paddle was "${previousPaddle.name}" (${previousPaddle.distance} km)`);
    if (nudge.trim()) parts.push(nudge.trim());
    return parts.join('. ') + '.';
  };

  const handleGenerate = async () => {
    Keyboard.dismiss();

    if (!destination.trim()) return;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const input = buildPrompt();
    pendingSearchRef.current = true;

    // Track the search event
    track('search_started', { destination, minDurationHrs, maxDurationHrs });

    // Start a background search (continues even if user navigates away)
    const bgSearchParams = {
      prompt: input,
      lat: locationCoords?.lat,
      lon: locationCoords?.lng,
      minDurationHrs,
      maxDurationHrs,
      maxTravelMins: maxTravelMins < 9999 ? maxTravelMins : undefined,
      location: locationCoords ? { lat: locationCoords.lat, lng: locationCoords.lng } : undefined,
      destination,
    };
    startBgSearch(bgSearchParams).catch(() => {});

    setPrompt(input);
    setLoading(true);
    setPlan(null);
    setPlanError(null);
    fadeAnim.setValue(0);
    setSelectedRouteIdx(-1);
    setExpandedRoute(-1);
    setResultsDate(null);
    setLoadingPct(0);
    setLoadingMsg(LOADING_MESSAGES[0]);
    setSearchSaved(false);
    setSavedSearchId(null);
    setDrawMode(false);
    setDrawnPoints([]);
    setAskAnswer(null);
    setAskText('');

    let msgIdx = 0;
    loadingMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[msgIdx]);
      setLoadingPct(prev => Math.min(90, prev + 12));
    }, 4000);

    try {
      const result = await planPaddleWithWeather({
        prompt: input,
        lat: locationCoords?.lat,
        lon: locationCoords?.lng,
        minDurationHrs,
        maxDurationHrs,
        maxTravelMins: maxTravelMins < 9999 ? maxTravelMins : undefined,
        location: locationCoords ? { lat: locationCoords.lat, lng: locationCoords.lng } : undefined,
        signal: controller.signal,
      });

      // Maritime-first: validate each route's waypoints for water-safe geometry
      if (result.routes) {
        result.routes = result.routes.map(r => {
          const validation = validateMaritimeRoute(r.waypoints || [], {
            maxSegmentKm: 10,
            declaredDistKm: r.distanceKm,
            skillKey: skillLevel?.key,
          });
          return {
            ...r,
            waypoints: r.waypoints, // preserve original format for PaddleMap
            _maritimeValidation: validation,
            _launchPoint: getRouteLaunchPoint(r),
          };
        });
      }

      pendingSearchRef.current = null;
      setPlan(result);
      setLoadingPct(100);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (e) {
      if (e.message === 'cancelled') {
        pendingSearchRef.current = null;
        // User cancelled — silently return to input screen
      } else {
        // Keep pendingSearchRef set so auto-retry can kick in on foreground
        setPlanError(e);
      }
    } finally {
      clearInterval(loadingMsgRef.current);
      loadingMsgRef.current = null;
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleRefine = async () => {
    if (!refineText.trim()) return;
    Keyboard.dismiss();
    setNudge(prev => (prev.trim() ? `${prev.trim()}. ${refineText.trim()}` : refineText.trim()));
    setRefineText('');
    setRefineOpen(false);

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const travelLabel = MAX_TRAVEL_OPTIONS.find(o => o.value === maxTravelMins)?.label ?? 'any distance';
    const parts = [
      `I'm near ${destination}`,
      `I want to paddle for between ${minDurationHrs} and ${maxDurationHrs} hour${maxDurationHrs > 1 ? 's' : ''}`,
    ];
    if (maxTravelMins < 9999) parts.push(`I can travel up to ${travelLabel} to reach the launch point`);
    if (previousPaddle) parts.push(`My last paddle was "${previousPaddle.name}" (${previousPaddle.distance} km)`);
    const currentNudge = nudge.trim() ? `${nudge.trim()}. ${refineText.trim()}` : refineText.trim();
    if (currentNudge) parts.push(currentNudge);
    const input = parts.join('. ') + '.';

    setLoading(true);
    setPlan(null);
    setPlanError(null);
    fadeAnim.setValue(0);
    setSelectedRouteIdx(-1);
    setExpandedRoute(-1);
    setResultsDate(null);
    setLoadingPct(0);
    setLoadingMsg(LOADING_MESSAGES[0]);
    setSearchSaved(false);
    setSavedSearchId(null);
    setDrawMode(false);
    setDrawnPoints([]);
    setAskAnswer(null);
    setAskText('');

    let msgIdx = 0;
    loadingMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[msgIdx]);
      setLoadingPct(prev => Math.min(90, prev + 12));
    }, 4000);

    try {
      const result = await planPaddleWithWeather({
        prompt: input,
        lat: locationCoords?.lat,
        lon: locationCoords?.lng,
        minDurationHrs,
        maxDurationHrs,
        maxTravelMins: maxTravelMins < 9999 ? maxTravelMins : undefined,
        location: locationCoords ? { lat: locationCoords.lat, lng: locationCoords.lng } : undefined,
        signal: controller.signal,
      });
      if (result.routes) {
        result.routes = result.routes.map(r => ({
          ...r,
          waypoints: r.waypoints,
          _maritimeValidation: validateMaritimeRoute(r.waypoints || [], { maxSegmentKm: 10, declaredDistKm: r.distanceKm, skillKey: skillLevel?.key }),
          _launchPoint: getRouteLaunchPoint(r),
        }));
      }
      setPlan(result);
      setLoadingPct(100);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (e) {
      if (e.message === 'cancelled') {
        // User cancelled — silently return to input screen
      } else {
        setPlanError(e);
      }
    } finally {
      clearInterval(loadingMsgRef.current);
      loadingMsgRef.current = null;
      setLoading(false);
    }
  };

  const handleCancelSearch = () => {
    if (abortRef.current) abortRef.current.abort();
    clearInterval(loadingMsgRef.current);
    loadingMsgRef.current = null;
    setLoading(false);
    abortRef.current = null;
    pendingSearchRef.current = null;
  };

  const reset = () => {
    setPlan(null); setPlanError(null); setPrompt(''); fadeAnim.setValue(0);
    setSelectedRouteIdx(0); setExpandedRoute(-1); setResultsDate(null);
    setDrawMode(false); setDrawnPoints([]);
    setSearchSaved(false); setSavedSearchId(null);
    setRefineText(''); setRefineOpen(false);
    setMapExpanded(false);
  };

  const difficultyColor = (d) => {
    const key = (d || '').toLowerCase();
    if (key === 'beginner' || key === 'easy') return { bg: colors.primaryLight, fg: colors.primary };
    if (key === 'intermediate' || key === 'moderate') return { bg: colors.primaryLight, fg: colors.primary };
    if (key === 'advanced' || key === 'challenging') return { bg: colors.cautionLight, fg: colors.caution };
    return { bg: colors.warnLight, fg: colors.warn };
  };

  // Check if a route is favorited
  const isRouteFavorited = (routeName) => savedRouteNames.has(routeName);

  const handleFinishDraw = () => {
    if (drawnPoints.length < 2) return;
    const distKm = drawnPoints.reduce((acc, pt, i) => {
      if (i === 0) return 0;
      const a = drawnPoints[i - 1], b = pt;
      const R = 6371;
      const dLat = (b.lat - a.lat) * Math.PI / 180;
      const dLon = (b.lon - a.lon) * Math.PI / 180;
      const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
      return acc + R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
    }, 0);
    const timeHrs = distKm / 4;
    const newWaypoints = drawnPoints.map(p => [p.lat, p.lon]);

    if (selectedRouteIdx >= 0) {
      // Update the selected suggestion in place — don't create a new route
      const updated = [...routes];
      updated[selectedRouteIdx] = {
        ...updated[selectedRouteIdx],
        waypoints: newWaypoints,
        distanceKm: parseFloat(distKm.toFixed(1)),
        estimated_duration: parseFloat(timeHrs.toFixed(1)),
        isDrawn: true,
      };
      setPlan(prev => ({ ...prev, routes: updated }));
      setDrawnPoints([]);
      setDrawMode(false);
    } else {
      // Overview / no selection — open save modal for a new custom route
      const drawnRoute = {
        name: 'Custom Route',
        isDrawn: true,
        waypoints: newWaypoints,
        distanceKm: parseFloat(distKm.toFixed(1)),
        estimated_duration: parseFloat(timeHrs.toFixed(1)),
        location: destination,
        locationCoords,
        difficulty: 'custom',
        description: `Hand-drawn route. ${distKm.toFixed(1)} km, ~${timeHrs < 1 ? Math.round(timeHrs * 60) + ' min' : timeHrs.toFixed(1) + 'h'} paddle.`,
        highlights: [],
        launchPoint: '',
        travelTimeMin: 0,
      };
      setSaveModalRoute(drawnRoute);
      setSaveNameInput('Custom Route');
    }
  };

  const handleToggleFavorite = (routeData) => {
    const name = routeData.name || '';
    if (isRouteFavorited(name)) {
      // Unfavorite
      if (Platform.OS === 'web') {
        if (!window.confirm(`Remove "${name}" from saved routes?`)) return;
        getSavedRoutes().then(saved => {
          const target = saved.find(r => r.name === name);
          if (target) deleteSavedRoute(target.id);
          setSavedRouteNames(prev => { const next = new Set(prev); next.delete(name); return next; });
        }).catch(() => {});
      } else {
        Alert.alert('Remove', `Remove "${name}" from saved routes?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => {
            getSavedRoutes().then(saved => {
              const target = saved.find(r => r.name === name);
              if (target) deleteSavedRoute(target.id);
              setSavedRouteNames(prev => { const next = new Set(prev); next.delete(name); return next; });
            }).catch(() => {});
          }},
        ]);
      }
    } else {
      // Open save modal — strip isDrawn so saving doesn't re-add to plan.routes
      setSaveModalRoute({ ...routeData, isDrawn: false });
      setSaveNameInput(name);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (locationCoords) {
        const weather = await getWeatherWithCache(locationCoords.lat, locationCoords.lng);
        setWeatherData(weather);
      }
      await loadSavedRouteNames();
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, [locationCoords, loadSavedRouteNames]);

  // ── ERROR STATE (Ticket 4) ──────────────────────────────────────────────
  if (planError && !plan && !loading) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          <View style={s.nav}>
            <TouchableOpacity onPress={reset} style={s.back}>
              <Text style={s.backText}>{'\u2039'}</Text>
            </TouchableOpacity>
            <Text style={s.navTitle}>Plan a Paddle</Text>
          </View>
          <ErrorState error={planError} onRetry={handleGenerate} />
        </SafeAreaView>
      </View>
    );
  }

  // ── INPUT SCREEN ─────────────────────────────────────────────────────────
  if (!plan && !loading) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          <View style={s.nav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
              <Text style={s.backText}>{'\u2039'}</Text>
            </TouchableOpacity>
            <Text style={s.navTitle}>Plan a Paddle</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.homeBtn}>
              <HomeIcon size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {locationCoords && (
            <PaddleMap
              height={180}
              coords={{ lat: locationCoords.lat, lon: locationCoords.lng }}
              routes={[]}
              selectedIdx={-1}
              overlayTitle={destination}
            />
          )}

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
          <ScrollView
            style={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          >
            {<>
            {/* Location */}
            <SectionHeader>Where are you paddling?</SectionHeader>
            <View style={s.inputCard}>
              <TextInput
                style={s.input}
                value={destination}
                onChangeText={handleDestinationChange}
                placeholder="e.g. Axminster, Bristol, Lake District..."
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
              />
              {searchLoading && <Text style={s.searchHint}>Searching...</Text>}
            </View>

            {showSearchResults && searchResults.length > 0 && (
              <View style={s.searchResults}>
                {searchResults.map((result, i) => (
                  <TouchableOpacity
                    key={`${result.lat}-${result.lng}-${i}`}
                    style={[s.searchResultItem, i < searchResults.length - 1 && s.searchResultBorder]}
                    onPress={() => selectSearchResult(result)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.searchResultLabel} numberOfLines={1}>{result.label}</Text>
                    <Text style={s.searchResultDetail} numberOfLines={1}>
                      {result.lat.toFixed(3)}, {result.lng.toFixed(3)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {locationCoords && (
              <View style={s.coordsBadge}>
                <Text style={s.coordsText}>
                  {locationCoords.lat.toFixed(4)}, {locationCoords.lng.toFixed(4)}
                </Text>
              </View>
            )}

            {/* Duration range */}
            <SectionHeader>How long do you want to paddle?</SectionHeader>
            <View style={s.durationRangeCard}>
              <View style={s.durationRangeRow}>
                <Text style={s.durationRangeLabel}>Min</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={s.durationChips}>
                    {MIN_HOURS_OPTIONS.map(h => (
                      <TouchableOpacity
                        key={h}
                        style={[s.durationChip, minDurationHrs === h && s.durationChipActive]}
                        onPress={() => { setMinDurationHrs(h); if (h > maxDurationHrs) setMaxDurationHrs(h); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.durationChipText, minDurationHrs === h && s.durationChipTextActive]}>
                          {h === 6 ? '6h+' : `${h}h`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <View style={[s.durationRangeRow, { marginTop: 8 }]}>
                <Text style={s.durationRangeLabel}>Max</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={s.durationChips}>
                    {MAX_HOURS_OPTIONS.map(h => (
                      <TouchableOpacity
                        key={h}
                        style={[s.durationChip, maxDurationHrs === h && s.durationChipActive, h < minDurationHrs && s.durationChipDisabled]}
                        onPress={() => h >= minDurationHrs && setMaxDurationHrs(h)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.durationChipText, maxDurationHrs === h && s.durationChipTextActive]}>
                          {h === 6 ? '6h+' : `${h}h`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <View style={s.durationSummary}>
                <Text style={s.durationSummaryText}>
                  {minDurationHrs === maxDurationHrs
                    ? `${minDurationHrs}h paddle`
                    : `${minDurationHrs}h – ${maxDurationHrs === 6 ? '6h+' : `${maxDurationHrs}h`} paddle`}
                </Text>
              </View>
            </View>

            {/* Max travel time */}
            <SectionHeader>Max travel to launch</SectionHeader>
            <View style={s.travelChips}>
              {MAX_TRAVEL_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.travelChip, maxTravelMins === opt.value && s.travelChipActive]}
                  onPress={() => setMaxTravelMins(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.travelChipText, maxTravelMins === opt.value && s.travelChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nudge */}
            <SectionHeader>Anything else?</SectionHeader>
            <View style={s.inputCard}>
              <TextInput
                style={[s.input, { minHeight: 60 }]}
                value={nudge}
                onChangeText={setNudge}
                placeholder={'e.g. "I want to see wildlife" or "avoid busy areas"'}
                placeholderTextColor={colors.textFaint}
                multiline
                textAlignVertical="top"
                returnKeyType="default"
              />
            </View>

            {!hasApiKey() && (
              <AlertBanner
                type="caution"
                title="AI planning unavailable"
                body="Backend CLAUDE_API_KEY not set. Check server/.env"
              />
            )}

            <TouchableOpacity
              style={[s.generateBtn, !destination.trim() && s.generateBtnDisabled]}
              onPress={handleGenerate}
              disabled={!destination.trim()}
              activeOpacity={0.85}
            >
              <Text style={s.generateBtnText}>Find Routes {'\u2192'}</Text>
            </TouchableOpacity>

            <View style={{ height: 48 }} />
            </>}
          </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.container, s.centered]}>
        <Image source={require('../../assets/icons/tortuga/ios/AppIcon-1024.png')} style={s.logoBadge} />
        <Text style={s.loadTitle}>Planning your paddle{'\u2026'}</Text>
        <Text style={s.loadPrompt} numberOfLines={2}>
          {`${destination} · ${minDurationHrs}–${maxDurationHrs}h paddle`}
        </Text>
        <View style={{ width: 200, marginTop: 16 }}>
          <ProgressBar startLabel="Analysing" endLabel="Done" pct={loadingPct} color={colors.primary} />
        </View>
        <Text style={s.loadStep}>{loadingMsg}</Text>
        <View style={s.dotsRow}>
          <LoadDot delay={0} /><LoadDot delay={200} /><LoadDot delay={400} />
        </View>
        <TouchableOpacity style={s.cancelBtn} onPress={handleCancelSearch} activeOpacity={0.7}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── RESULTS ───────────────────────────────────────────────────────────────
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
  const drawnTimeHrs = drawnDistKm / 4; // ~4 km/h average paddling speed
  const routes  = plan.routes  || [];
  const sel     = routes[selectedRouteIdx] || {};

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={reset} style={s.back}>
            <Text style={s.backText}>{'\u2039'}</Text>
          </TouchableOpacity>
          {selectedRouteIdx >= 0 && editingRouteName ? (
            <TextInput
              style={s.navTitleInput}
              value={routeNameInput}
              onChangeText={setRouteNameInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                const trimmed = routeNameInput.trim();
                if (trimmed) {
                  const updated = [...routes];
                  updated[selectedRouteIdx] = { ...updated[selectedRouteIdx], name: trimmed };
                  setPlan(prev => ({ ...prev, routes: updated }));
                }
                setEditingRouteName(false);
              }}
              onBlur={() => setEditingRouteName(false)}
            />
          ) : selectedRouteIdx >= 0 ? (
            <TouchableOpacity style={s.navTitleBtn} onPress={() => { setRouteNameInput(sel.name || ''); setEditingRouteName(true); }} activeOpacity={0.7}>
              <Text style={s.navTitle} numberOfLines={1}>{sel.name || 'Route'}</Text>
              <Text style={s.navTitlePencil}>✎</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.navTitle}>{plan.location?.base || 'Your Routes'}</Text>
          )}
          <View style={{ width: 8 }} />
          <TouchableOpacity
            style={[s.saveSearchBtn, searchSaved && s.saveSearchBtnSaved]}
            onPress={async () => {
              if (searchSaved) {
                try {
                  if (savedSearchId) await deleteSavedSearch(savedSearchId);
                  setSearchSaved(false);
                  setSavedSearchId(null);
                } catch { /* ignore */ }
                return;
              }
              try {
                const entry = await saveSearch({ location: destination, locationCoords, minDurationHrs, maxDurationHrs, plan });
                setSearchSaved(true);
                setSavedSearchId(entry?.id ?? null);
              } catch { /* ignore */ }
            }}
            activeOpacity={0.7}
          >
            <Text style={[s.saveSearchIcon, searchSaved && s.saveSearchIconSaved]}>
              {searchSaved ? '✕' : '⌕'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.homeBtn}>
            <HomeIcon size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Map — animates taller when expanded or drawing */}
        <Animated.View style={{ height: mapHeightAnim, overflow: 'hidden' }}>
          <PaddleMap
            height={drawMode ? Math.round(screenHeight * 0.64) : mapExpanded ? Math.round(screenHeight * 0.52) : 310}
            coords={locationCoords ? { lat: locationCoords.lat, lon: locationCoords.lng } : undefined}
            routes={routes}
            selectedIdx={selectedRouteIdx}
            overlayMeta={selectedRouteIdx >= 0 ? (sel.launchPoint || plan.location?.base) : undefined}
            drawMode={drawMode}
            drawnPoints={drawnPoints}
            onAddPoint={pt => setDrawnPoints(prev => [...prev, pt])}
            onMovePoint={(idx, pt) => setDrawnPoints(prev => prev.map((p, i) => i === idx ? pt : p))}
            windHourly={weatherData?.hourly || []}
            windDate={resultsDate}
            onWindDateChange={setResultsDate}
            tideHeightMap={tideHeightMap}
            tideExtremeMap={tideExtremeMap}
          />
          {/* Draw stats overlay — top of map, semi-transparent */}
          {drawMode && drawnPoints.length > 0 && (
            <View style={s.drawStatsOverlay}>
              <Text style={s.drawStatsText}>
                {drawnDistKm.toFixed(1)} km
                {'  ·  '}
                {drawnTimeHrs < 1 ? `~${Math.round(drawnTimeHrs * 60)} min` : `~${drawnTimeHrs.toFixed(1)} h`}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Draw controls */}
        <View style={selectedRouteIdx === -1 && !drawMode && drawnPoints.length === 0 ? s.drawCtaBar : s.drawBar}>
          {selectedRouteIdx === -1 && !drawMode && drawnPoints.length === 0 ? (
            <TouchableOpacity style={s.drawCta} onPress={() => setDrawMode(true)} activeOpacity={0.8}>
              <Text style={s.drawCtaIcon}>✦</Text>
              <View style={s.drawCtaTextWrap}>
                <Text style={s.drawCtaTitle}>Draw your own route</Text>
                <Text style={s.drawCtaSub}>Tap a route above to view details, or draw directly on the map</Text>
              </View>
              <Text style={s.drawCtaArrow}>›</Text>
            </TouchableOpacity>
          ) : (
            <>
              {!drawMode && (
                <TouchableOpacity
                  style={s.mapExpandBtn}
                  onPress={() => setMapExpanded(e => !e)}
                  activeOpacity={0.75}
                >
                  <Text style={s.mapExpandBtnText}>{mapExpanded ? '↑ Map' : '↓ Map'}</Text>
                </TouchableOpacity>
              )}
            <TouchableOpacity
              style={[s.drawToggle, drawMode && s.drawClearBtn]}
              onPress={() => {
                if (drawMode) {
                  setDrawnPoints([]);
                  setDrawMode(false);
                } else {
                  if (selectedRouteIdx >= 0) {
                    const selRoute = routes[selectedRouteIdx];
                    const pts = (Array.isArray(selRoute?.waypoints) ? selRoute.waypoints : [])
                      .map(w => Array.isArray(w) ? { lat: w[0], lon: w[1] } : w)
                      .filter(p => p?.lat != null && p?.lon != null);
                    setDrawnPoints(pts);
                  }
                  setDrawMode(true);
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={[s.drawToggleText, drawMode && s.drawClearBtnText]}>
                {drawMode ? 'Clear' : 'Draw route'}
              </Text>
            </TouchableOpacity>
            </>
          )}

          {drawMode && (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <TouchableOpacity style={s.drawAction} onPress={() => setDrawnPoints(p => p.slice(0, -1))} activeOpacity={0.7}>
                <Text style={s.drawActionText}>Undo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.drawAction}
                onPress={() => drawnPoints.length > 0 && setDrawnPoints(p => [...p, p[0]])}
                activeOpacity={0.7}
              >
                <Text style={s.drawActionText}>Loop</Text>
              </TouchableOpacity>
            </View>
          )}
          {drawMode && drawnPoints.length >= 2 && (
            <TouchableOpacity style={s.drawFinish} onPress={handleFinishDraw} activeOpacity={0.85}>
              <Text style={s.drawFinishText}>Finish</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Vertical scrollable route list */}
        <Animated.ScrollView
          style={{ opacity: fadeAnim, flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Conditions — above routes */}
          {/* Refine search */}
          {refineOpen ? (
            <View style={s.refineSearchBox}>
              <TextInput
                style={s.refineSearchInput}
                value={refineText}
                onChangeText={setRefineText}
                placeholder="e.g. make it shorter, coastal only, avoid busy areas…"
                placeholderTextColor={colors.textFaint}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleRefine}
              />
              <View style={s.refineSearchBtns}>
                <TouchableOpacity style={s.refineSearchCancel} onPress={() => { setRefineOpen(false); setRefineText(''); }} activeOpacity={0.7}>
                  <Text style={s.refineSearchCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.refineSearchGo, !refineText.trim() && s.refineSearchGoDisabled]}
                  disabled={!refineText.trim()}
                  onPress={handleRefine}
                  activeOpacity={0.85}
                >
                  <Text style={s.refineSearchGoText}>Regenerate →</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.refineSearchBar} onPress={() => setRefineOpen(true)} activeOpacity={0.7}>
              <Text style={s.refineSearchBarLabel}>
                {destination}
                {'  ·  '}
                {minDurationHrs === maxDurationHrs ? `${minDurationHrs}h` : `${minDurationHrs}–${maxDurationHrs}h`}
                {nudge.trim() ? `  ·  ${nudge.trim()}` : ''}
              </Text>
              <Text style={s.refineSearchBarEdit}>Edit</Text>
            </TouchableOpacity>
          )}

          <SectionHeader style={{ paddingTop: 8 }}>Conditions</SectionHeader>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateStrip}>
            <TouchableOpacity
              style={[s.dateDayChip, resultsDate === null && s.dateDayChipActive, { minWidth: 52 }]}
              onPress={() => setResultsDate(null)}
              activeOpacity={0.7}
            >
              <Text style={[s.dateDayName, resultsDate === null && s.dateDayNameActive]}>ANY</Text>
              <Text style={[s.dateDayNum, resultsDate === null && s.dateDayNumActive, { fontSize: 11 }]}>{'\u2014'}</Text>
            </TouchableOpacity>
            {RESULTS_DATE_STRIP.map((dateStr) => {
              const isSelected = resultsDate === dateStr;
              const isToday    = dateStr === getTodayString();
              const d          = new Date(dateStr + 'T12:00:00');
              const dayName    = d.toLocaleDateString('en', { weekday: 'short' });
              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[s.dateDayChip, isSelected && s.dateDayChipActive]}
                  onPress={() => setResultsDate(isSelected ? null : dateStr)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.dateDayName, isSelected ? s.dateDayNameActive : isToday && s.dateDayToday]}>
                    {isToday ? 'Today' : dayName}
                  </Text>
                  <Text style={[s.dateDayNum, isSelected && s.dateDayNumActive]}>{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {resultsDate && (
            weatherData && weatherDates.has(resultsDate) ? (
              <ConditionsTimeline
                hourly={weatherData.hourly}
                date={resultsDate}
                startHour={9}
                endHour={18}
                routeBearing={gpxRouteBearing(sel?.waypoints)}
                tideHeightMap={tideHeightMap}
                tideExtremeMap={tideExtremeMap}
              />
            ) : (
              <View style={[s.weatherCard, { marginHorizontal: P, marginBottom: 4 }]}>
                <Text style={s.weatherNoForecast}>
                  {weatherLoading ? 'Loading forecast…' : 'No forecast available for this date'}
                </Text>
              </View>
            )
          )}

          {/* Route cards — primary focus */}
          {routes.map((r, i) => {
            const dc        = difficultyColor(r.difficulty_rating || r.difficulty);
            const isActive  = selectedRouteIdx === i;
            const isEditing = editingRouteIdx === i;
            const handleDelete = () => {
              const newRoutes = routes.filter((_, idx) => idx !== i);
              setPlan(prev => ({ ...prev, routes: newRoutes }));
              if (selectedRouteIdx === i) setSelectedRouteIdx(newRoutes.length > 0 ? 0 : -1);
              else if (selectedRouteIdx > i) setSelectedRouteIdx(prev => prev - 1);
            };
            return (
              <View key={i} style={s.routeCardWrap}>
                <TouchableOpacity
                  style={[s.routeCard, isActive && s.routeCardSel]}
                  onPress={() => { setSelectedRouteIdx(isActive ? -1 : i); setEditingRouteIdx(-1); }}
                  activeOpacity={0.85}
                >
                  {/* Single compact row: name + meta + heart */}
                  <View style={s.routeRow}>
                    <View style={[s.diffDot, { backgroundColor: dc.fg }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.routeName} numberOfLines={1}>{r.name}</Text>
                      <Text style={s.routeMeta}>
                        {[
                          r.distanceKm ? `${r.distanceKm} km` : null,
                          r.estimated_duration ? `~${r.estimated_duration}h paddle` : null,
                          r.travelTimeMin ? (r.travelTimeMin >= 60
                            ? `${Math.floor(r.travelTimeMin / 60)}h${r.travelTimeMin % 60 ? ` ${r.travelTimeMin % 60}m` : ''} drive`
                            : `${r.travelTimeMin} min drive`) : null,
                          r.difficulty_rating || r.difficulty || null,
                        ].filter(Boolean).join('  ·  ')}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[s.saveRouteBtn, isRouteFavorited(r.name) && s.saveRouteBtnSaved]}
                      onPress={() => handleToggleFavorite({ ...r, location: plan.location?.base || destination, locationCoords })}
                      activeOpacity={0.75}
                    >
                      <HeartIcon filled={isRouteFavorited(r.name)} size={14} color={isRouteFavorited(r.name) ? '#fff' : colors.primary} />
                      <Text style={[s.saveRouteBtnText, isRouteFavorited(r.name) && s.saveRouteBtnTextSaved]}>
                        {isRouteFavorited(r.name) ? 'Saved' : 'Save'}
                      </Text>
                    </TouchableOpacity>
                    {/* spacer for the absolute delete button */}
                    <View style={{ width: 28 }} />
                  </View>

                  {/* Description — only when selected */}
                  {isActive && r.description ? (
                    <Text style={s.routeDescInline}>{r.description}</Text>
                  ) : null}

                  {/* Navigate button — only when selected */}
                  {isActive && r._launchPoint && (
                    <TouchableOpacity
                      style={s.navigateBtn}
                      onPress={() => {
                        const url = buildNavigateToStartUrl(r._launchPoint.lat, r._launchPoint.lon);
                        if (Platform.OS === 'web') { window.open(url, '_blank'); }
                        else { import('react-native').then(({ Linking }) => Linking.openURL(url)); }
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={s.navigateBtnText}>Navigate to Start</Text>
                    </TouchableOpacity>
                  )}

                  {/* Open full route detail */}
                  {isActive && (
                    <TouchableOpacity
                      style={s.viewRouteBtn}
                      onPress={() => navigation.navigate('SavedRoutes', {
                        previewRoute: {
                          ...r,
                          location:      plan.location?.base || destination,
                          locationCoords: locationCoords ? { lat: locationCoords.lat, lng: locationCoords.lng } : null,
                        },
                      })}
                      activeOpacity={0.85}
                    >
                      <Text style={s.viewRouteBtnText}>View full route →</Text>
                    </TouchableOpacity>
                  )}

                  {/* Inline refinement — only when selected */}
                  {isActive && isEditing && (
                    editLoading ? (
                      <View style={s.refineLoading}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={s.refineLoadingText}>Refining route…</Text>
                      </View>
                    ) : (
                      <View style={s.refineBox}>
                        <TextInput
                          style={s.refineInput}
                          value={editText}
                          onChangeText={setEditText}
                          placeholder='e.g. "Make it shorter" or "Avoid open sea crossings"'
                          placeholderTextColor={colors.textFaint}
                          multiline
                          autoFocus
                        />
                        <View style={s.refineActions}>
                          <TouchableOpacity style={s.refineCancelBtn} onPress={() => { setEditingRouteIdx(-1); setEditText(''); }} activeOpacity={0.7}>
                            <Text style={s.refineCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[s.refineSubmitBtn, !editText.trim() && s.refineSubmitDisabled]}
                            disabled={!editText.trim()}
                            onPress={async () => {
                              if (!editText.trim()) return;
                              setEditLoading(true);
                              try {
                                const updated = await refineRoute(r, editText.trim());
                                const newRoutes = [...routes];
                                newRoutes[i] = { ...r, ...updated, _maritimeValidation: undefined, _launchPoint: getRouteLaunchPoint(updated) };
                                setPlan(prev => ({ ...prev, routes: newRoutes }));
                                setEditingRouteIdx(-1);
                                setEditText('');
                              } catch (e) {
                                Alert.alert('Error', e.message || 'Could not refine route.');
                              } finally {
                                setEditLoading(false);
                              }
                            }}
                            activeOpacity={0.85}
                          >
                            <Text style={s.refineSubmitText}>Apply</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )
                  )}
                  {isActive && !isEditing && (
                    <TouchableOpacity
                      style={s.refineBtn}
                      onPress={() => { setEditingRouteIdx(i); setEditText(''); }}
                      activeOpacity={0.7}
                    >
                      <Text style={s.refineBtnText}>Edit this route…</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                {/* Delete button — outside the card TouchableOpacity to avoid nested press conflicts */}
                <TouchableOpacity
                  style={s.routeDeleteBtn}
                  onPress={handleDelete}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.routeDeleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {plan.weatherNote && <AlertBanner type="caution" title="Weather" body={plan.weatherNote} />}
          {plan.safetyNote  && <AlertBanner type="warn"    title="Safety"  body={plan.safetyNote}  />}

          {/* Ask AI */}
          <SectionHeader style={{ marginTop: 8 }}>Ask about conditions</SectionHeader>
          <View style={s.askCard}>
            {askAnswer ? (
              <>
                <View style={s.askBubble}>
                  <Text style={s.askBubbleText}>{askAnswer}</Text>
                </View>
                <TouchableOpacity onPress={() => { setAskAnswer(null); setAskText(''); }} style={s.askClear} activeOpacity={0.7}>
                  <Text style={s.askClearText}>Ask another question</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={s.askRow}>
                <TextInput
                  style={s.askInput}
                  value={askText}
                  onChangeText={setAskText}
                  placeholder="e.g. Is it safe to paddle tomorrow morning?"
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="send"
                  onSubmitEditing={async () => {
                    if (!askText.trim() || askLoading) return;
                    setAskLoading(true);
                    try {
                      const answer = await askSafety({ question: askText.trim(), weather: weatherData, routes });
                      setAskAnswer(answer);
                    } catch { setAskAnswer('Sorry, I couldn\'t answer that right now. Please try again.'); }
                    finally { setAskLoading(false); }
                  }}
                  editable={!askLoading}
                />
                <TouchableOpacity
                  style={[s.askBtn, (!askText.trim() || askLoading) && s.askBtnDisabled]}
                  disabled={!askText.trim() || askLoading}
                  onPress={async () => {
                    if (!askText.trim() || askLoading) return;
                    setAskLoading(true);
                    try {
                      const answer = await askSafety({ question: askText.trim(), weather: weatherData, routes });
                      setAskAnswer(answer);
                    } catch { setAskAnswer('Sorry, I couldn\'t answer that right now. Please try again.'); }
                    finally { setAskLoading(false); }
                  }}
                  activeOpacity={0.85}
                >
                  {askLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.askBtnText}>Ask</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={{ height: 48 }} />
        </Animated.ScrollView>

        {/* Save Route modal */}
        <Modal
          visible={!!saveModalRoute}
          transparent
          animationType="fade"
          onRequestClose={() => setSaveModalRoute(null)}
        >
          <View style={s.modalBackdrop}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Save Route</Text>
              <Text style={s.modalSub}>Give this route a name so you can find it later.</Text>
              <TextInput
                style={s.modalInput}
                value={saveNameInput}
                onChangeText={setSaveNameInput}
                placeholder="Route name\u2026"
                placeholderTextColor={colors.textFaint}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={async () => {
                  if (!saveNameInput.trim() || !saveModalRoute || saving) return;
                  setSaving(true);
                  try {
                    const namedRoute = { ...saveModalRoute, name: saveNameInput.trim() };
                    await saveRoute(namedRoute, saveNameInput.trim());
                    setSavedRouteNames(prev => new Set(prev).add(saveModalRoute.name));
                    if (saveModalRoute.isDrawn) {
                      setPlan(prev => ({ ...prev, routes: [...(prev.routes || []), namedRoute] }));
                      setSelectedRouteIdx((plan.routes?.length) || 0);
                      setDrawnPoints([]);
                      setDrawMode(false);
                    }
                    setSaveModalRoute(null);
                    Alert.alert('Saved', `"${saveNameInput.trim()}" added to your routes.`);
                  } catch { Alert.alert('Error', 'Could not save \u2014 please try again.'); }
                  finally { setSaving(false); }
                }}
              />
              <View style={s.modalBtns}>
                <TouchableOpacity style={s.modalCancel} onPress={() => setSaveModalRoute(null)} activeOpacity={0.7}>
                  <Text style={s.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSave, (!saveNameInput.trim() || saving) && s.modalSaveDisabled]}
                  activeOpacity={0.85}
                  disabled={!saveNameInput.trim() || saving}
                  onPress={async () => {
                    setSaving(true);
                    try {
                      const namedRoute = { ...saveModalRoute, name: saveNameInput.trim() };
                      await saveRoute(namedRoute, saveNameInput.trim());
                      setSavedRouteNames(prev => new Set(prev).add(saveModalRoute.name));
                      if (saveModalRoute.isDrawn) {
                        setPlan(prev => ({ ...prev, routes: [...(prev.routes || []), namedRoute] }));
                        setSelectedRouteIdx((plan.routes?.length) || 0);
                        setDrawnPoints([]);
                        setDrawMode(false);
                      }
                      setSaveModalRoute(null);
                      Alert.alert('Saved', `"${saveNameInput.trim()}" added to your routes.`);
                    } catch { Alert.alert('Error', 'Could not save \u2014 please try again.'); }
                    finally { setSaving(false); }
                  }}
                >
                  <Text style={s.modalSaveText}>{saving ? 'Saving\u2026' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

// Loading dot
function LoadDot({ delay }) {
  const anim = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.2, duration: 400, useNativeDriver: true }),
    ])).start();
  }, []);
  return <Animated.View style={[s.dot, { opacity: anim }]} />;
}

const P = 20;
const FF = fontFamily;
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  safe:       { flex: 1 },
  centered:   { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 20 },
  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:   { fontSize: 24, color: colors.primary },
  navTitle:      { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginLeft: 4 },
  navTitleBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 4 },
  navTitlePencil:{ fontSize: 15, color: colors.textMuted },
  navTitleInput: { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginLeft: 4, paddingVertical: 2, paddingHorizontal: 4, borderBottomWidth: 1.5, borderBottomColor: colors.primary },
  saveRouteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
  saveRouteBtnSaved:{ backgroundColor: colors.primary, borderColor: colors.primary },
  saveRouteBtnText: { fontSize: 13, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary },
  saveRouteBtnTextSaved: { color: '#fff' },
  // Ask AI
  askCard:       { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 18, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  askRow:        { flexDirection: 'row', gap: 10, alignItems: 'center' },
  askInput:      { flex: 1, fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.text, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.bgDeep, borderRadius: 10, borderWidth: 1, borderColor: colors.borderLight, minHeight: 40 },
  askBtn:        { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minWidth: 48 },
  askBtnDisabled:{ backgroundColor: colors.textFaint },
  askBtnText:    { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: '#fff' },
  askBubble:     { backgroundColor: colors.primaryLight, borderRadius: 10, padding: 12 },
  askBubbleText: { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.text, lineHeight: 20 },
  askClear:      { marginTop: 8, alignSelf: 'flex-start' },
  askClearText:  { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.primary },

  routeCardWrap:         { position: 'relative' },
  routeDeleteBtn:        { position: 'absolute', top: 10, right: 10, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  routeDeleteBtnText:    { fontSize: 14, color: colors.textMuted },
  saveSearchBtn:         { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, marginRight: 6, alignItems: 'center', justifyContent: 'center' },
  saveSearchBtnSaved:    { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  saveSearchIcon:        { fontSize: 18, fontWeight: '400', color: colors.textMid, lineHeight: 20 },
  saveSearchIconSaved:   { color: colors.primary, fontWeight: '600', fontSize: 15 },
  countBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  countText:  { fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
  scroll:     { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  inputCard:  { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 18, padding: P, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  input:      { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.text, lineHeight: 22, minHeight: 40 },
  searchHint: { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, marginTop: 4 },

  searchResults: { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 14, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, overflow: 'hidden' },
  searchResultItem: { paddingHorizontal: 14, paddingVertical: 12 },
  searchResultBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  searchResultLabel: { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.text, marginBottom: 2 },
  searchResultDetail: { fontSize: 12, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted },

  coordsBadge: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.primaryLight, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  coordsText:  { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.primary },

  // Date strip (used on results screen for weather date picker)
  dateStrip:         { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingBottom: 8 },
  dateDayChip:       { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minWidth: 52 },
  dateDayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDayName:       { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  dateDayNameActive: { color: 'rgba(255,255,255,0.75)' },
  dateDayToday:      { color: colors.primary, fontWeight: '600', fontFamily: FF.semibold },
  dateDayNum:        { fontSize: 17, fontWeight: '500', fontFamily: FF.medium, color: colors.text, lineHeight: 20 },
  dateDayNumActive:  { color: '#fff' },

  // Duration range picker
  durationRangeCard:    { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 18, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  durationRangeRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  durationRangeLabel:   { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, width: 28 },
  durationChips:        { flexDirection: 'row', gap: 6 },
  durationSummary:      { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  durationSummaryText:  { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.primary, textAlign: 'center' },

  // Max travel picker
  travelChips:          { flexDirection: 'row', gap: 8, marginHorizontal: P, marginBottom: 8, flexWrap: 'wrap' },
  travelChip:           { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center' },
  travelChipActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  travelChipText:       { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  travelChipTextActive: { color: '#fff', fontWeight: '500', fontFamily: FF.medium },

  // Weather card
  weatherCard:     { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 18, padding: 12, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  weatherLoading:     { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', paddingVertical: 14 },
  weatherNoForecast:  { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', paddingVertical: 14 },
  weatherRow:      { flexDirection: 'row', marginBottom: 6 },
  weatherCell:     { flex: 1, alignItems: 'center' },
  weatherCellLabel:{ fontSize: 10, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  weatherCellValue:{ fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  safetyBar:       { height: 3, backgroundColor: colors.borderLight, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  safetyFill:      { height: '100%', borderRadius: 2 },
  safetyScore:     { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', marginTop: 3 },

  // Skill
  skillGrid:       { marginHorizontal: P, flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  skillCard:       { width: '48%', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight, padding: 11, flexGrow: 1, flexBasis: '45%' },
  skillCardActive: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryLight },
  skillLabel:      { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.text, marginBottom: 2 },
  skillLabelActive:{ color: colors.primary, fontWeight: '600', fontFamily: FF.semibold },
  skillEffort:     { fontSize: 12, fontWeight: '300', fontFamily: FF.light, color: colors.textMid, marginBottom: 2, lineHeight: 16 },
  skillMeta:       { fontSize: 10, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted },
  stravaNote:      { fontSize: 12, fontWeight: '300', fontFamily: FF.light, color: colors.primary, marginHorizontal: P, marginBottom: 8, fontStyle: 'italic' },

  previousPaddle:      { marginHorizontal: P, marginBottom: 6, backgroundColor: colors.primaryLight, borderRadius: 10, padding: 10, paddingHorizontal: 12 },
  previousPaddleLabel: { fontSize: 11, fontWeight: '500', fontFamily: FF.medium, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  previousPaddleValue: { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.text, lineHeight: 18 },

  stopsWrap:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: P, marginBottom: 8 },
  stopChip:        { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  stopChipActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
  stopChipText:    { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  stopChipTextActive: { color: '#fff', fontWeight: '500', fontFamily: FF.medium },

  generateBtn:         { marginHorizontal: P, marginTop: 8, backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  generateBtnDisabled: { backgroundColor: '#c8c4bc', shadowOpacity: 0 },
  generateBtnText:     { fontSize: 16, fontWeight: '500', fontFamily: FF.medium, color: '#fff' },

  logoBadge:  { width: 72, height: 72, borderRadius: 16, marginBottom: 14 },
  logoEmoji:  { fontSize: 26 },
  loadTitle:  { fontSize: 16, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  loadPrompt: { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
  loadStep:   { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.primary, textAlign: 'center', marginTop: 2 },
  dotsRow:    { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  cancelBtn:  { marginTop: 12, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border },
  cancelBtnText: { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.textMid },

  // Results
  driveBadge:     { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  driveBadgeText: { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.text },

  summaryStrip:     { flexDirection: 'row', marginHorizontal: P, marginVertical: 8, backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  summaryCell:      { flex: 1, paddingVertical: 11, alignItems: 'center' },
  summaryCellBorder:{ borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryCellLabel: { fontSize: 10, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  summaryCellValue: { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.text, textTransform: 'capitalize' },

  // Ticket 2: Check Conditions banner
  checkConditionsBanner: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight },
  checkConditionsText:   { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },

  routeStyleBar:      { flexDirection: 'row', marginHorizontal: P, marginBottom: 4, backgroundColor: '#e1e0db', borderRadius: 10, padding: 2, gap: 2 },
  routeStyleTab:      { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
  routeStyleTabActive:{ backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  routeStyleLabel:    { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted },
  routeStyleLabelActive: { fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  routeStyleMeta:     { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textFaint, marginTop: 1 },
  routeStyleMetaActive: { color: colors.textMid },

  weatherImpact:     { marginHorizontal: P, marginBottom: 4, backgroundColor: colors.primaryLight, borderRadius: 10, padding: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.borderLight },
  weatherImpactTitle:{ fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary, marginBottom: 2 },
  weatherImpactBody: { fontSize: 12.5, fontWeight: '300', fontFamily: FF.light, color: colors.textMid, lineHeight: 17 },

  tabContent:  { paddingHorizontal: P, paddingTop: 2 },
  routeCard:   { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  routeCardSel:{ borderWidth: 1.5, borderColor: colors.primary },
  routeRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 12, gap: 12 },
  diffDot:     { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  routeMeta:   { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, marginTop: 1 },
  routeHeader: { flexDirection: 'row', alignItems: 'center', padding: 13, gap: 10, borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  rankBadge:   { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText:    { fontSize: 11, fontWeight: '600', fontFamily: FF.semibold },
  routeName:   { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  diffBadge:   { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  diffText:    { fontSize: 11, fontWeight: '500', fontFamily: FF.medium },
  routeDesc:   { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMid, paddingHorizontal: 13, paddingVertical: 8, lineHeight: 18, borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStats:  { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStat:   { flex: 1, padding: 11, borderRightWidth: 0.5, borderRightColor: '#f0ede8' },
  routeStatLabel: { fontSize: 9.5, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  routeStatValue: { fontSize: 16, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  routeDetail: { padding: 13 },
  routeWhy:    { fontSize: 13, color: colors.textMid, lineHeight: 20, fontWeight: '300', fontFamily: FF.light, marginBottom: 5 },
  routeMetaRow:{ fontSize: 12.5, color: colors.textMid, fontWeight: '300', fontFamily: FF.light, marginBottom: 3, lineHeight: 18 },
  routeMetaKey:{ fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  condTip:     { backgroundColor: colors.cautionLight, borderRadius: 7, padding: 8, marginTop: 5 },
  condTipText: { fontSize: 12, color: colors.caution, fontWeight: '300', fontFamily: FF.light, lineHeight: 17 },
  weatherTip:  { backgroundColor: colors.primaryLight, borderRadius: 7, padding: 8, marginTop: 2, marginBottom: 5 },
  weatherTipText: { fontSize: 12, color: colors.primary, fontWeight: '300', fontFamily: FF.light, lineHeight: 17 },
  highlights:  { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  highlightChip: { backgroundColor: colors.bgDeep, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 },
  highlightText: { fontSize: 11, color: colors.textMid, fontWeight: '300', fontFamily: FF.light },

  kitCard:     { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  kitRow:      { flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11 },
  kitRowBorder:{ borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  kitDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  kitText:     { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.text },
  emptyTab:    { fontSize: 14, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  dataSource:  { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textFaint, textAlign: 'center', marginTop: 4, marginBottom: 8 },

  descBar:               { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: P, paddingVertical: 10, backgroundColor: colors.primaryLight, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 8 },
  descText:              { flex: 1, fontSize: 14, fontWeight: '300', fontFamily: FF.light, color: colors.textMid, lineHeight: 19 },
  descToggle:            { fontSize: 11, color: colors.textMuted, paddingTop: 2 },

  routeSelectorScroll:    { backgroundColor: colors.white, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  routeSelector:          { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingVertical: 8 },
  routeSelectorTab:       { width: 92, backgroundColor: colors.bgDeep, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9, borderLeftWidth: 3, borderLeftColor: colors.border },
  routeSelectorTabActive: { backgroundColor: '#e8edf8' },
  routeSelectorRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  routeSelectorNum:       { fontSize: 11, fontWeight: '600', fontFamily: FF.semibold, color: colors.textMuted },
  routeSelectorNumActive: { color: colors.textMid },
  routeSelectorName:      { fontSize: 12, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  routeSelectorNameActive:{ color: colors.text },
  routeSelectorMeta:      { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.textMuted },
  routeSelectorMetaActive:{ color: colors.textMid },

  routesList:       { paddingHorizontal: P, paddingTop: 2 },
  routeDescInline:  { fontSize: 13, fontWeight: '300', fontFamily: FF.light, color: colors.textMid, marginTop: 2, marginHorizontal: P, lineHeight: 17 },
  onMapLabel:       { fontSize: 10, fontWeight: '500', fontFamily: FF.medium, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },

  // Route action buttons
  routeActions:       { flexDirection: 'row', gap: 8, marginHorizontal: P, marginBottom: 8 },
  navigateBtn:        { marginHorizontal: P, marginBottom: 6, backgroundColor: colors.good, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  viewRouteBtn:       { marginHorizontal: P, marginTop: 10, marginBottom: 12, borderRadius: 10, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  viewRouteBtnText:   { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  navigateBtnText:    { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff', letterSpacing: 0.2 },

  homeBtn:     { paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },

  refineBtn:         { marginHorizontal: P, marginBottom: P, paddingVertical: 12, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  refineBtnText:     { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  // Refine search bar
  refineSearchBar:        { marginHorizontal: P, marginBottom: 8, marginTop: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11 },
  refineSearchBarLabel:   { flex: 1, fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  refineSearchBarEdit:    { fontSize: 13, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary, marginLeft: 8 },
  refineSearchBox:        { marginHorizontal: P, marginBottom: 8, marginTop: 6, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, padding: 14 },
  refineSearchInput:      { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.text, minHeight: 40, lineHeight: 22 },
  refineSearchBtns:       { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  refineSearchCancel:     { paddingHorizontal: 16, paddingVertical: 9 },
  refineSearchCancelText: { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted },
  refineSearchGo:         { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9 },
  refineSearchGoDisabled: { backgroundColor: colors.border },
  refineSearchGoText:     { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  refineLoading:     { margin: P, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, justifyContent: 'center' },
  refineLoadingText: { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.primary },
  refineBox:         { margin: P, backgroundColor: colors.bgDeep, borderRadius: 12, padding: 12 },
  refineInput:       { fontSize: 15, fontWeight: '400', fontFamily: FF.regular, color: colors.text, minHeight: 56, lineHeight: 22 },
  refineActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  refineCancelBtn:   { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  refineCancelText:  { fontSize: 14, fontWeight: '500', fontFamily: FF.medium, color: colors.textMid },
  refineSubmitBtn:   { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 9, backgroundColor: colors.primary },
  refineSubmitDisabled: { backgroundColor: colors.textFaint },
  refineSubmitText:  { fontSize: 14, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  // Maritime validation warnings
  maritimeWarning:      { backgroundColor: colors.cautionLight, borderRadius: 8, padding: 10, marginTop: 8 },
  maritimeWarningTitle: { fontSize: 12, fontWeight: '600', fontFamily: FF.semibold, color: colors.caution, marginBottom: 3 },
  maritimeWarningText:  { fontSize: 11, fontWeight: '300', fontFamily: FF.light, color: colors.caution, lineHeight: 16 },

  // Duration chip (shared)
  durationChip:          { backgroundColor: colors.bgDeep, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  durationChipActive:    { backgroundColor: colors.primary },
  durationChipDisabled:  { opacity: 0.3 },
  durationChipText:      { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  durationChipTextActive:{ color: '#fff', fontWeight: '500', fontFamily: FF.medium },

  // Save modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard:     { width: '100%', backgroundColor: colors.white, borderRadius: 18, padding: 22, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  modalTitle:    { fontSize: 19, fontWeight: '600', fontFamily: FF.semibold, color: colors.text, marginBottom: 4 },
  modalSub:      { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginBottom: 16, lineHeight: 19 },
  modalInput:    { backgroundColor: colors.bgDeep, borderRadius: 12, borderWidth: 1, borderColor: colors.border, fontSize: 16, fontWeight: '400', fontFamily: FF.regular, color: colors.text, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 },
  modalBtns:     { flexDirection: 'row', gap: 10 },
  modalCancel:   { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modalCancelText: { fontSize: 16, fontWeight: '500', fontFamily: FF.medium, color: colors.textMid },
  modalSave:        { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  modalSaveDisabled:{ backgroundColor: '#c8c4bc' },
  modalSaveText:    { fontSize: 16, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },

  drawBar:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, gap: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.white, zIndex: 10, elevation: 2 },
  mapExpandBtn:        { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  mapExpandBtnText:    { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  drawStatsOverlay:    { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', pointerEvents: 'none' },
  drawStatsText:       { backgroundColor: 'rgba(0,0,0,0.42)', color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: FF.semibold, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 22, overflow: 'hidden', letterSpacing: 0.2 },
  drawClearBtn:        { borderColor: colors.warn + 'aa', backgroundColor: colors.warnLight || '#fff5f0' },
  drawClearBtnText:    { color: colors.warn },
  drawCtaBar:          { borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.white, paddingHorizontal: P, paddingVertical: 10, zIndex: 10, elevation: 2 },
  drawCta:             { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primaryLight, borderRadius: 12, borderWidth: 1, borderColor: colors.primary + '33', paddingHorizontal: 16, paddingVertical: 12 },
  drawCtaIcon:         { fontSize: 18, color: colors.primary },
  drawCtaTextWrap:     { flex: 1 },
  drawCtaTitle:        { fontSize: 14, fontWeight: '600', fontFamily: FF.semibold, color: colors.primary },
  drawCtaSub:          { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid, marginTop: 1, lineHeight: 16 },
  drawCtaArrow:        { fontSize: 20, color: colors.primary, lineHeight: 22 },
  drawToggle:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.primary },
  drawToggleActive:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.primary },
  drawToggleText:      { fontSize: 13, fontWeight: '500', fontFamily: FF.medium, color: colors.primary },
  drawToggleTextActive:{ color: '#fff' },
  drawStat:            { alignItems: 'center', paddingHorizontal: 8 },
  drawStatVal:         { fontSize: 14, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  drawStatLabel:       { fontSize: 11, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted },
  drawAction:          { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  drawActionText:      { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.textMid },
  drawClear:           { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.warn + '88' },
  drawClearText:       { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: colors.warn },
  drawFinish:          { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.primary },
  drawFinishText:      { fontSize: 13, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
});
