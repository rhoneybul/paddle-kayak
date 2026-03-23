import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Animated, Keyboard, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import {
  SectionHeader, AlertBanner, PrimaryButton, ProgressBar,
  CampsiteCard, TabBar, Slider, SegmentedControl,
} from '../components/UI';
import MapSketch from '../components/MapSketch';
import { planPaddleWithWeather, hasApiKey } from '../services/claudeService';
import { SKILL_LEVELS, getStravaTokens, fetchStravaActivities, inferSkillFromStrava } from '../services/stravaService';
import { searchLocations, MIN_SEARCH_LENGTH, SEARCH_DEBOUNCE_MS } from '../services/geocodingService';
import { getWeatherWithCache } from '../services/weatherService';

const TRANSPORT_OPTIONS = ['Car', 'Public Transport'];

const DESIRED_STOPS = ['Coffee', 'Pub', 'Swim', 'Campsite', 'Picnic', 'Wildlife'];

const SKILL_OPTIONS = [
  { ...SKILL_LEVELS.BEGINNER, effort: 'Easy \u2014 flat water, gentle pace' },
  { ...SKILL_LEVELS.INTERMEDIATE, effort: 'Moderate \u2014 coastal or river, steady pace' },
  { ...SKILL_LEVELS.ADVANCED, effort: 'Hard \u2014 open water, challenging conditions' },
  { ...SKILL_LEVELS.EXPERT, effort: 'Expert \u2014 expedition-grade, all conditions' },
];

const ROUTE_STYLE_LABELS = ['Scenic', 'Fast', 'Coastal'];

const LOADING_MESSAGES = [
  'Analysing local waters...',
  'Checking weather conditions...',
  'Finding launch points...',
  'Building route options...',
  'Assessing safety...',
];

/**
 * Get today's date as YYYY-MM-DD string.
 */
function getTodayString() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * Validate that a date string is not in the past.
 * @param {string} dateStr — YYYY-MM-DD
 * @returns {boolean}
 */
export function isDateValid(dateStr) {
  if (!dateStr) return false;
  const today = getTodayString();
  return dateStr >= today;
}

/**
 * Validate that a duration is at least 1 hour.
 * @param {number} hrs
 * @returns {boolean}
 */
export function isDurationValid(hrs) {
  return typeof hrs === 'number' && hrs >= 1;
}

/**
 * Format a date string (YYYY-MM-DD) into a readable label.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const today = getTodayString();
  if (dateStr === today) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmStr = tomorrow.getFullYear() + '-' +
    String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
  if (dateStr === tmStr) return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function PlannerScreen({ navigation }) {
  // ── Ticket 1: Date & Duration state ───────────────────────────────────────
  const [tripDate, setTripDate]     = useState(getTodayString()); // YYYY-MM-DD
  const [duration, setDuration]     = useState(3);       // hours (1-8)

  // ── Ticket 3: Location search state ───────────────────────────────────────
  const [destination, setDestination]     = useState('');
  const [locationCoords, setLocationCoords] = useState(null); // { lat, lng }
  const [searchResults, setSearchResults]   = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchLoading, setSearchLoading]   = useState(false);
  const searchTimerRef = useRef(null);

  // ── Ticket 2: Weather forecast state ──────────────────────────────────────
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Structured inputs
  const [transport, setTransport]     = useState('Car');
  const [selectedStops, setSelectedStops] = useState([]);
  const [skillLevel, setSkillLevel]   = useState(SKILL_LEVELS.INTERMEDIATE);
  const [previousPaddle, setPreviousPaddle] = useState(null); // Strava-inferred info
  const [stravaLoaded, setStravaLoaded] = useState(false);

  // Legacy prompt for free-text fallback
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [plan, setPlan] = useState(null);
  const [activeTab, setActiveTab] = useState('routes');
  // Index into the routes array — maps to the three route styles
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // Which route card is expanded (or -1 for none)
  const [expandedRoute, setExpandedRoute] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const loadingMsgRef = useRef(null);

  // ── Pre-fill destination with GPS location ────────────────────────────────
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
        const label =
          data.address?.city || data.address?.town ||
          data.address?.village || data.address?.county || '';
        if (label && !destination) {
          setDestination(label);
          setLocationCoords({ lat, lng: lon });
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Load Strava skill inference if connected ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const tokens = await getStravaTokens();
        if (!tokens) return;
        const activities = await fetchStravaActivities(50);
        if (activities.length > 0) {
          const inferred = inferSkillFromStrava(activities);
          setSkillLevel(inferred);

          // Find most recent paddle activity for "previous paddle" context
          const paddleTypes = ['Kayaking', 'Canoeing', 'Rowing', 'StandUpPaddling', 'Surfing'];
          const lastPaddle = activities.find(a => paddleTypes.includes(a.type));
          if (lastPaddle) {
            setPreviousPaddle({
              name: lastPaddle.name,
              distance: (lastPaddle.distance / 1000).toFixed(1),
              date: new Date(lastPaddle.start_date).toLocaleDateString(),
              type: lastPaddle.type,
            });
          }
          setStravaLoaded(true);
        }
      } catch { /* Strava not available */ }
    })();
  }, []);

  // ── Ticket 2: Fetch weather when location coords change ──────────────────
  useEffect(() => {
    if (!locationCoords) {
      setWeatherData(null);
      return;
    }
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

  // ── Ticket 3: Debounced location search ───────────────────────────────────
  const handleDestinationChange = useCallback((text) => {
    setDestination(text);
    // Clear coords when user types (they haven't selected a result yet)
    if (locationCoords) setLocationCoords(null);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (text.trim().length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchLocations(text);
        setSearchResults(results);
        setShowSearchResults(results.length > 0);
      } catch {
        setSearchResults([]);
        setShowSearchResults(false);
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

  const toggleStop = (stop) => {
    setSelectedStops(prev =>
      prev.includes(stop) ? prev.filter(s => s !== stop) : [...prev, stop]
    );
  };

  // ── Ticket 1: Date picker handler with validation ────────────────────────
  const handleDateChange = useCallback((dateStr) => {
    if (isDateValid(dateStr)) {
      setTripDate(dateStr);
    }
  }, []);

  // ── Quick date buttons ────────────────────────────────────────────────────
  const setDateToToday = () => setTripDate(getTodayString());
  const setDateToTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    setTripDate(d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0'));
  };
  const setDateToWeekend = () => {
    const d = new Date();
    const dayOfWeek = d.getDay();
    const daysToSat = dayOfWeek === 6 ? 0 : (6 - dayOfWeek);
    d.setDate(d.getDate() + (daysToSat === 0 ? 7 : daysToSat));
    setTripDate(d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0'));
  };

  // Build structured prompt from form inputs
  const buildPrompt = () => {
    const parts = [];
    parts.push(`I'm in ${destination}`);
    parts.push(`and want a ${duration}-hour day paddle`);
    parts.push(`I have access to ${transport.toLowerCase()}`);
    if (skillLevel) parts.push(`My skill level is ${skillLevel.label.toLowerCase()}`);
    if (selectedStops.length > 0) parts.push(`I'd like stops for: ${selectedStops.join(', ').toLowerCase()}`);
    if (previousPaddle) {
      parts.push(`My last paddle was "${previousPaddle.name}" (${previousPaddle.distance} km on ${previousPaddle.date})`);
    }
    // Effort estimate based on skill level
    const skillOpt = SKILL_OPTIONS.find(s => s.key === skillLevel.key);
    if (skillOpt) parts.push(`Effort preference: ${skillOpt.effort}`);
    return parts.join('. ') + '.';
  };

  // ── Ticket 5: Updated handleGenerate to pass date, duration, location ────
  const handleGenerate = async () => {
    Keyboard.dismiss();
    if (!destination.trim()) return;

    // Validate date
    if (!isDateValid(tripDate)) {
      Alert.alert('Invalid Date', 'Please select a date that is today or in the future.');
      return;
    }

    // Validate duration
    if (!isDurationValid(duration)) {
      Alert.alert('Invalid Duration', 'Please select a duration of at least 1 hour.');
      return;
    }

    if (!hasApiKey()) {
      Alert.alert(
        'API Key Required',
        'Add your Claude API key to .env:\n\nEXPO_PUBLIC_CLAUDE_API_KEY=sk-ant-...\n\nGet a free key at console.anthropic.com',
      );
      return;
    }

    const input = buildPrompt();
    setPrompt(input);
    setLoading(true);
    setPlan(null);
    fadeAnim.setValue(0);
    setSelectedRouteIdx(0);
    setExpandedRoute(0);
    setActiveTab('routes');
    setLoadingPct(0);
    setLoadingMsg(LOADING_MESSAGES[0]);

    // Rotate loading messages while waiting
    let msgIdx = 0;
    loadingMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[msgIdx]);
      setLoadingPct(prev => Math.min(90, prev + 12));
    }, 4000);

    try {
      // Ticket 5: Pass date, duration, and coordinates to Claude service
      const result = await planPaddleWithWeather({
        prompt: input,
        lat: locationCoords?.lat,
        lon: locationCoords?.lng,
        date: tripDate,
        durationHrs: duration,
        transport: transport.toLowerCase().replace(' ', '_'),
        interests: selectedStops.length > 0 ? selectedStops : undefined,
        location: locationCoords ? { lat: locationCoords.lat, lng: locationCoords.lng } : undefined,
      });
      setPlan(result);
      setLoadingPct(100);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (e) {
      Alert.alert('Could not plan paddle', e.message);
    } finally {
      clearInterval(loadingMsgRef.current);
      loadingMsgRef.current = null;
      setLoading(false);
    }
  };

  const reset = () => {
    setPlan(null);
    setPrompt('');
    fadeAnim.setValue(0);
    setSelectedRouteIdx(0);
    setExpandedRoute(0);
  };

  // ── Difficulty badge helper ───────────────────────────────────────────────
  const difficultyColor = (d) => {
    const key = (d || '').toLowerCase();
    if (key === 'beginner' || key === 'easy') return { bg: colors.goodLight, fg: colors.good };
    if (key === 'intermediate' || key === 'moderate' || key === 'easy-moderate') return { bg: colors.blueLight, fg: colors.blue };
    if (key === 'advanced' || key === 'challenging') return { bg: colors.cautionLight, fg: colors.caution };
    return { bg: colors.warnLight, fg: colors.warn };
  };

  // ── INPUT ─────────────────────────────────────────────────────────────────
  if (!plan && !loading) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          <View style={s.nav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
              <Text style={s.backText}>{'\u2039'}</Text>
            </TouchableOpacity>
            <Text style={s.navTitle}>Plan a Paddle</Text>
          </View>

          <ScrollView
            style={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.scrollContent}
          >
            {/* ── Ticket 3: Location search ─────────────────────────────── */}
            <SectionHeader>Destination / Region</SectionHeader>
            <View style={s.inputCard}>
              <TextInput
                style={s.input}
                value={destination}
                onChangeText={handleDestinationChange}
                placeholder="e.g. Axminster, Bristol, Lake District..."
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
              />
              {searchLoading && (
                <Text style={s.searchHint}>Searching...</Text>
              )}
            </View>

            {/* Location search results dropdown */}
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

            {/* Coordinates display (when selected) */}
            {locationCoords && (
              <View style={s.coordsBadge}>
                <Text style={s.coordsText}>
                  {locationCoords.lat.toFixed(4)}, {locationCoords.lng.toFixed(4)}
                </Text>
              </View>
            )}

            {/* ── Ticket 1: Date picker ─────────────────────────────────── */}
            <SectionHeader>Trip Date</SectionHeader>
            <View style={s.dateSection}>
              <View style={s.dateQuickBtns}>
                {[
                  { label: 'Today', onPress: setDateToToday },
                  { label: 'Tomorrow', onPress: setDateToTomorrow },
                  { label: 'Weekend', onPress: setDateToWeekend },
                ].map((btn) => {
                  const active = formatDateLabel(tripDate) === btn.label ||
                    (btn.label === 'Weekend' && new Date(tripDate + 'T12:00:00').getDay() === 6);
                  return (
                    <TouchableOpacity
                      key={btn.label}
                      style={[s.dateChip, active && s.dateChipActive]}
                      onPress={btn.onPress}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.dateChipText, active && s.dateChipTextActive]}>{btn.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.dateInputRow}>
                <TextInput
                  style={s.dateInput}
                  value={tripDate}
                  onChangeText={handleDateChange}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textFaint}
                  keyboardType={Platform.OS === 'web' ? 'default' : 'default'}
                  maxLength={10}
                />
                <Text style={s.dateLabel}>{formatDateLabel(tripDate)}</Text>
              </View>
              {!isDateValid(tripDate) && tripDate.length === 10 && (
                <Text style={s.validationError}>Date must be today or in the future</Text>
              )}
            </View>

            {/* ── Ticket 1: Duration slider ─────────────────────────────── */}
            <SectionHeader>Duration</SectionHeader>
            <Slider
              min={1}
              max={8}
              step={1}
              value={duration}
              onValueChange={setDuration}
              label="Paddle time"
              unit="hrs"
            />

            {/* ── Ticket 2: Weather forecast display ────────────────────── */}
            {locationCoords && (
              <>
                <SectionHeader>Weather Forecast</SectionHeader>
                {weatherLoading ? (
                  <View style={s.weatherCard}>
                    <Text style={s.weatherLoading}>Loading forecast...</Text>
                  </View>
                ) : weatherData ? (
                  <View style={s.weatherCard}>
                    <View style={s.weatherRow}>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Conditions</Text>
                        <Text style={s.weatherCellValue}>{weatherData.current.condition.icon} {weatherData.current.condition.label}</Text>
                      </View>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Temp</Text>
                        <Text style={s.weatherCellValue}>{weatherData.current.temp}{'\u00B0'}C</Text>
                      </View>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Wind</Text>
                        <Text style={s.weatherCellValue}>{weatherData.current.windSpeed} kt {weatherData.current.windDirLabel}</Text>
                      </View>
                    </View>
                    <View style={s.weatherRow}>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Waves</Text>
                        <Text style={s.weatherCellValue}>{weatherData.current.waveHeight} m</Text>
                      </View>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Safety</Text>
                        <Text style={[s.weatherCellValue, { color: weatherData.safetyColor }]}>{weatherData.safetyLabel}</Text>
                      </View>
                      <View style={s.weatherCell}>
                        <Text style={s.weatherCellLabel}>Window</Text>
                        <Text style={[s.weatherCellValue, { color: weatherData.weatherWindow?.color || colors.textMid }]}>
                          {weatherData.weatherWindow?.label || '\u2014'}
                        </Text>
                      </View>
                    </View>
                    {/* Safety score bar */}
                    <View style={s.safetyBar}>
                      <View style={[s.safetyFill, { width: `${weatherData.safetyScore}%`, backgroundColor: weatherData.safetyColor }]} />
                    </View>
                    <Text style={s.safetyScore}>Safety Score: {weatherData.safetyScore}/100</Text>
                  </View>
                ) : null}
              </>
            )}

            {/* Transport */}
            <SectionHeader>Getting there</SectionHeader>
            <SegmentedControl
              options={TRANSPORT_OPTIONS}
              value={transport}
              onChange={setTransport}
            />

            {/* Skill level */}
            <SectionHeader>Paddling proficiency</SectionHeader>
            {previousPaddle && (
              <View style={s.previousPaddle}>
                <Text style={s.previousPaddleLabel}>Previous paddle</Text>
                <Text style={s.previousPaddleValue}>
                  {previousPaddle.name} {'\u00b7'} {previousPaddle.distance} km {'\u00b7'} {previousPaddle.date}
                </Text>
              </View>
            )}
            <View style={s.skillGrid}>
              {SKILL_OPTIONS.map((sk) => (
                <TouchableOpacity
                  key={sk.key}
                  style={[s.skillCard, skillLevel.key === sk.key && s.skillCardActive]}
                  onPress={() => setSkillLevel(sk)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.skillLabel, skillLevel.key === sk.key && s.skillLabelActive]}>{sk.label}</Text>
                  <Text style={s.skillEffort}>{sk.effort}</Text>
                  <Text style={s.skillMeta}>Max {sk.maxWindKnots} kts {'\u00b7'} {sk.maxDistKm} km/day</Text>
                </TouchableOpacity>
              ))}
            </View>
            {stravaLoaded && (
              <Text style={s.stravaNote}>Skill auto-detected from Strava activities</Text>
            )}

            {/* Desired stops */}
            <SectionHeader>Desired stops</SectionHeader>
            <View style={s.stopsWrap}>
              {DESIRED_STOPS.map((stop) => (
                <TouchableOpacity
                  key={stop}
                  style={[s.stopChip, selectedStops.includes(stop) && s.stopChipActive]}
                  onPress={() => toggleStop(stop)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.stopChipText, selectedStops.includes(stop) && s.stopChipTextActive]}>{stop}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* API key warning */}
            {!hasApiKey() && (
              <AlertBanner
                type="caution"
                title="AI planning unavailable"
                body="Add EXPO_PUBLIC_CLAUDE_API_KEY to your .env to enable AI-powered trip planning. Get a key at console.anthropic.com"
              />
            )}

            {/* Generate button */}
            <TouchableOpacity
              style={[s.generateBtn, !destination.trim() && s.generateBtnDisabled]}
              onPress={handleGenerate}
              disabled={!destination.trim()}
              activeOpacity={0.85}
            >
              <Text style={s.generateBtnText}>Generate Trip {'\u2192'}</Text>
            </TouchableOpacity>

            <View style={{ height: 48 }} />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.container, s.centered]}>
        <View style={s.logoBadge}><Text style={s.logoEmoji}>{'\uD83D\uDEF6'}</Text></View>
        <Text style={s.loadTitle}>Planning your paddle{'\u2026'}</Text>
        <Text style={s.loadPrompt} numberOfLines={2}>
          {destination} {'\u00b7'} {formatDateLabel(tripDate)} {'\u00b7'} {duration}h {'\u00b7'} {skillLevel.label}
        </Text>
        <View style={{ width: 200, marginTop: 8 }}>
          <ProgressBar
            startLabel="Analysing"
            endLabel="Done"
            pct={loadingPct}
            color={colors.good}
          />
        </View>
        <Text style={s.loadStep}>{loadingMsg}</Text>
        <View style={s.dotsRow}>
          <LoadDot delay={0} /><LoadDot delay={200} /><LoadDot delay={400} />
        </View>
      </View>
    );
  }

  // ── RESULTS ───────────────────────────────────────────────────────────────
  const routes     = plan.routes   || [];
  const campsites  = plan.campsites || [];
  const packing    = plan.packingHighlights || [];
  const isMultiDay = ['weekend', 'week', 'multi_day'].includes(plan.trip?.type);

  // Build the three route-style tabs (Scenic / Fast / Coastal)
  const routeStyleTabs = routes.map((r, i) => ({
    key: `route_${i}`,
    label: ROUTE_STYLE_LABELS[i] || `Route ${i + 1}`,
  }));

  // Content tabs below the route selector
  const contentTabs = [
    { key: 'routes', label: `Routes (${routes.length})` },
    ...(campsites.length > 0 ? [{ key: 'campsites', label: `Camps (${campsites.length})` }] : []),
    { key: 'kit', label: 'Kit' },
  ];

  const sel = routes[selectedRouteIdx] || {};

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={reset} style={s.back}>
            <Text style={s.backText}>{'\u2039'}</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>{plan.location?.base || 'Your Paddle'}</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{routes.length}</Text>
          </View>
        </View>

        {/* ── Ticket 4: Map with location pin ─────────────────────────── */}
        <MapSketch
          height={200}
          routes={[
            { type: 'solid', d: 'M92 165 C92 132,74 104,100 77 C122 54,157 48,173 62 C188 76,182 104,169 122' },
            ...(routes.length > 1 ? [{ type: 'dashed', d: 'M92 165 C104 142,128 131,142 139 C155 146,153 160,145 165', color: colors.mapRouteAlt }] : []),
            ...(routes.length > 2 ? [{ type: 'faint', d: 'M92 165 C80 140,75 112,88 95 C100 78,120 70,140 80', color: colors.blue }] : []),
          ]}
          waypoints={[
            { x: 92, y: 165, type: 'start' },
            { x: 169, y: 122, type: 'end' },
            ...(routes.length > 1 ? [{ x: 145, y: 165, type: 'mid' }] : []),
            ...(routes.length > 2 ? [{ x: 140, y: 80, type: 'mid' }] : []),
            ...(isMultiDay ? [{ x: 126, y: 72, type: 'camp' }, { x: 148, y: 82, type: 'camp', faded: true }] : []),
          ]}
          locationPin={locationCoords ? { x: 138, y: 100, label: destination } : undefined}
          overlayTitle={plan.understood}
          overlayMeta={`${plan.location?.base} \u00b7 ${formatDateLabel(tripDate)} \u00b7 ${(plan.trip?.type || '').replace('_', ' ')} \u00b7 ${plan.conditions?.skillLevel || 'intermediate'}`}
          showLegend={{
            routes: routes.slice(0, 3).map((r, i) => ({
              label: ROUTE_STYLE_LABELS[i] || r.name,
              color: i === 0 ? colors.mapRoute : i === 1 ? colors.mapRouteAlt : colors.blue,
              faint: i > 0,
            })),
            ...(isMultiDay && campsites.length > 0 ? { campsites: `Campsites (${campsites.length})` } : {}),
          }}
        />

        {/* Summary strip */}
        <View style={s.summaryStrip}>
          {[
            ['Base', plan.location?.base || '\u2014'],
            ['Date', formatDateLabel(tripDate)],
            ['Type', (plan.trip?.type || '\u2014').replace('_', ' ')],
            ['Skill', plan.conditions?.skillLevel || '\u2014'],
          ].map(([label, value], i) => (
            <View key={label} style={[s.summaryCell, i < 3 && s.summaryCellBorder]}>
              <Text style={s.summaryCellLabel}>{label}</Text>
              <Text style={s.summaryCellValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Three-route style selector (Scenic / Fast / Coastal) */}
        <View style={s.routeStyleBar}>
          {routeStyleTabs.map((tab, i) => {
            const active = selectedRouteIdx === i;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[s.routeStyleTab, active && s.routeStyleTabActive]}
                onPress={() => { setSelectedRouteIdx(i); setExpandedRoute(i); }}
                activeOpacity={0.8}
              >
                <Text style={[s.routeStyleLabel, active && s.routeStyleLabelActive]}>
                  {tab.label}
                </Text>
                {routes[i] && (
                  <Text style={[s.routeStyleMeta, active && s.routeStyleMetaActive]}>
                    {routes[i].distanceKm ? `${routes[i].distanceKm} km` : ''}
                    {routes[i].estimated_duration ? ` \u00b7 ${routes[i].estimated_duration}h` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Weather impact banner for the selected route */}
        {sel.weather_impact_summary && (
          <View style={s.weatherImpact}>
            <Text style={s.weatherImpactTitle}>Weather Impact</Text>
            <Text style={s.weatherImpactBody}>{sel.weather_impact_summary}</Text>
          </View>
        )}

        <TabBar tabs={contentTabs} active={activeTab} onChange={setActiveTab} />

        <Animated.ScrollView style={{ opacity: fadeAnim, flex: 1 }} showsVerticalScrollIndicator={false}>

          {/* ROUTES TAB */}
          {activeTab === 'routes' && (
            <View style={s.tabContent}>
              {routes.map((r, i) => {
                const dc = difficultyColor(r.difficulty_rating || r.difficulty);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.routeCard, selectedRouteIdx === i && s.routeCardSel]}
                    onPress={() => {
                      setSelectedRouteIdx(i);
                      setExpandedRoute(expandedRoute === i ? -1 : i);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={s.routeHeader}>
                      <View style={[s.rankBadge, { backgroundColor: i === 0 ? colors.goodLight : i === 1 ? colors.blueLight : colors.cautionLight }]}>
                        <Text style={[s.rankText, { color: i === 0 ? colors.good : i === 1 ? colors.blue : colors.caution }]}>{ROUTE_STYLE_LABELS[i] ? ROUTE_STYLE_LABELS[i][0] : i + 1}</Text>
                      </View>
                      <Text style={s.routeName}>{r.name}</Text>
                      <View style={[s.diffBadge, { backgroundColor: dc.bg }]}>
                        <Text style={[s.diffText, { color: dc.fg }]}>{r.difficulty_rating || r.difficulty}</Text>
                      </View>
                    </View>

                    {r.description ? (
                      <Text style={s.routeDesc}>{r.description}</Text>
                    ) : null}

                    <View style={s.routeStats}>
                      {[
                        ['Distance', r.distanceKm ? `${r.distanceKm} km` : '\u2014'],
                        ['Time', r.estimated_duration ? `~${r.estimated_duration}h` : r.durationHours ? `~${r.durationHours}h` : '\u2014'],
                        ['Terrain', r.terrain || '\u2014'],
                      ].map(([l, v]) => (
                        <View key={l} style={s.routeStat}>
                          <Text style={s.routeStatLabel}>{l}</Text>
                          <Text style={s.routeStatValue}>{v}</Text>
                        </View>
                      ))}
                    </View>

                    {expandedRoute === i && (
                      <View style={s.routeDetail}>
                        <Text style={s.routeWhy}>{r.why}</Text>

                        {r.weather_impact_summary ? (
                          <View style={s.weatherTip}>
                            <Text style={s.weatherTipText}>{r.weather_impact_summary}</Text>
                          </View>
                        ) : null}

                        {r.launchPoint ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Launch  </Text>{r.launchPoint}</Text> : null}
                        {r.travelFromBase ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Travel  </Text>{r.travelFromBase} {'\u00b7'} {r.travelTimeMin} min</Text> : null}
                        {r.bestConditions ? (
                          <View style={s.condTip}>
                            <Text style={s.condTipText}>{r.bestConditions}</Text>
                          </View>
                        ) : null}
                        {r.highlights?.length > 0 && (
                          <View style={s.highlights}>
                            {r.highlights.map((h) => (
                              <View key={h} style={s.highlightChip}>
                                <Text style={s.highlightText}>{h}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              {plan.weatherNote && (
                <AlertBanner type="caution" title="Weather" body={plan.weatherNote} />
              )}
              {plan.safetyNote && (
                <AlertBanner type="warn" title="Safety" body={plan.safetyNote} />
              )}

              <PrimaryButton
                label="Check Conditions & Start \u2192"
                onPress={() => navigation.navigate('Weather', { planResult: plan, selectedRoute: sel })}
                style={{ marginTop: 4 }}
              />
            </View>
          )}

          {/* CAMPSITES TAB */}
          {activeTab === 'campsites' && (
            <View style={s.tabContent}>
              {campsites.length > 0 ? campsites.map((c, i) => (
                <CampsiteCard
                  key={i}
                  name={c.name}
                  nearRoute={c.nearRoute}
                  distKm={c.distanceFromWaterKm}
                  type={c.type}
                  beach={c.type === 'beach'}
                  water={c.type === 'formal'}
                  source="RIDB / OSM"
                />
              )) : (
                <Text style={s.emptyTab}>No campsites for a day paddle</Text>
              )}
              <Text style={s.dataSource}>Data: Recreation.gov (RIDB) + OpenStreetMap</Text>
            </View>
          )}

          {/* KIT TAB */}
          {activeTab === 'kit' && (
            <View style={s.tabContent}>
              <View style={s.kitCard}>
                {packing.map((item, i) => (
                  <View key={i} style={[s.kitRow, i < packing.length - 1 && s.kitRowBorder]}>
                    <View style={s.kitDot} />
                    <Text style={s.kitText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 48 }} />
        </Animated.ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Loading dot ───────────────────────────────────────────────────────────────
function LoadDot({ delay }) {
  const anim = useRef(new Animated.Value(0.2)).current;
  React.useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.2, duration: 400, useNativeDriver: true }),
    ])).start();
  }, []);
  return <Animated.View style={[s.dot, { opacity: anim }]} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const P = 12;
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  safe:       { flex: 1 },
  centered:   { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  // Nav
  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:   { fontSize: 22, color: colors.good },
  navTitle:   { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  countBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  countText:  { fontSize: 10, fontWeight: '600', color: colors.bg },
  scroll:     { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  // Input
  inputCard:  { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: P, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  input:      { fontSize: 13, fontWeight: '400', color: colors.text, lineHeight: 20, minHeight: 36 },
  searchHint: { fontSize: 9, fontWeight: '300', color: colors.textMuted, marginTop: 4 },
  // Search results
  searchResults: { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, overflow: 'hidden' },
  searchResultItem: { paddingHorizontal: 12, paddingVertical: 10 },
  searchResultBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  searchResultLabel: { fontSize: 12, fontWeight: '500', color: colors.text, marginBottom: 2 },
  searchResultDetail: { fontSize: 10, fontWeight: '300', color: colors.textMuted },
  // Coordinates badge
  coordsBadge: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.blueLight, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  coordsText: { fontSize: 9, fontWeight: '400', color: colors.blue },
  // Date section
  dateSection: { marginHorizontal: P, marginBottom: 8 },
  dateQuickBtns: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  dateChip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  dateChipActive: { backgroundColor: colors.good, borderColor: colors.good },
  dateChipText: { fontSize: 11, fontWeight: '400', color: colors.textMid },
  dateChipTextActive: { color: colors.white, fontWeight: '500' },
  dateInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  dateInput: { flex: 1, fontSize: 13, fontWeight: '400', color: colors.text, minHeight: 24 },
  dateLabel: { fontSize: 11, fontWeight: '300', color: colors.good },
  validationError: { fontSize: 10, fontWeight: '400', color: colors.warn, marginTop: 4 },
  // Weather card (Ticket 2)
  weatherCard: { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, padding: 10, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  weatherLoading: { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  weatherRow: { flexDirection: 'row', marginBottom: 6 },
  weatherCell: { flex: 1, alignItems: 'center' },
  weatherCellLabel: { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  weatherCellValue: { fontSize: 11, fontWeight: '500', color: colors.text },
  safetyBar: { height: 3, backgroundColor: colors.borderLight, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  safetyFill: { height: '100%', borderRadius: 2 },
  safetyScore: { fontSize: 9, fontWeight: '300', color: colors.textMuted, textAlign: 'center', marginTop: 3 },
  // Skill grid
  skillGrid:  { marginHorizontal: P, flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  skillCard:  { width: '48%', backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.borderLight, padding: 9, flexGrow: 1, flexBasis: '45%' },
  skillCardActive: { borderColor: colors.good, borderWidth: 1.5, backgroundColor: colors.goodLight },
  skillLabel: { fontSize: 12, fontWeight: '500', color: colors.text, marginBottom: 2 },
  skillLabelActive: { color: colors.good, fontWeight: '600' },
  skillEffort: { fontSize: 10, fontWeight: '300', color: colors.textMid, marginBottom: 2, lineHeight: 14 },
  skillMeta:  { fontSize: 8.5, fontWeight: '300', color: colors.textMuted },
  stravaNote: { fontSize: 10, fontWeight: '300', color: colors.good, marginHorizontal: P, marginBottom: 8, fontStyle: 'italic' },
  // Previous paddle
  previousPaddle: { marginHorizontal: P, marginBottom: 6, backgroundColor: colors.blueLight, borderRadius: 7, padding: 8, paddingHorizontal: 10 },
  previousPaddleLabel: { fontSize: 9, fontWeight: '500', color: colors.blue, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  previousPaddleValue: { fontSize: 11, fontWeight: '300', color: colors.text, lineHeight: 16 },
  // Desired stops
  stopsWrap:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: P, marginBottom: 8 },
  stopChip:   { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  stopChipActive: { backgroundColor: colors.good, borderColor: colors.good },
  stopChipText: { fontSize: 12, fontWeight: '400', color: colors.textMid },
  stopChipTextActive: { color: colors.white, fontWeight: '500' },
  // Generate button
  generateBtn: { marginHorizontal: P, marginTop: 8, backgroundColor: colors.good, borderRadius: 10, padding: 14, alignItems: 'center', shadowColor: colors.good, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  generateBtnDisabled: { backgroundColor: '#c8c4bc', shadowOpacity: 0 },
  generateBtnText: { fontSize: 14, fontWeight: '500', color: '#fff' },
  // Logo
  logoBadge:  { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  logoEmoji:  { fontSize: 24 },
  // Loading
  loadTitle:  { fontSize: 14, fontWeight: '400', color: colors.textMid },
  loadPrompt: { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 18 },
  loadStep:   { fontSize: 11, fontWeight: '400', color: colors.good, textAlign: 'center', marginTop: 2 },
  dotsRow:    { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.good },
  // Results — summary strip
  summaryStrip: { flexDirection: 'row', marginHorizontal: P, marginVertical: 8, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  summaryCell: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  summaryCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryCellLabel: { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  summaryCellValue: { fontSize: 12, fontWeight: '500', color: colors.text, textTransform: 'capitalize' },
  // Route style bar (Scenic / Fast / Coastal)
  routeStyleBar: { flexDirection: 'row', marginHorizontal: P, marginBottom: 8, backgroundColor: '#e1e0db', borderRadius: 8, padding: 2, gap: 2 },
  routeStyleTab: { flex: 1, padding: 8, alignItems: 'center', borderRadius: 6 },
  routeStyleTabActive: { backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  routeStyleLabel: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  routeStyleLabelActive: { fontWeight: '600', color: colors.text },
  routeStyleMeta: { fontSize: 9, fontWeight: '300', color: colors.textFaint, marginTop: 1 },
  routeStyleMetaActive: { color: colors.textMid },
  // Weather impact banner
  weatherImpact: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.blueLight, borderRadius: 8, padding: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.borderLight },
  weatherImpactTitle: { fontSize: 10, fontWeight: '600', color: colors.blue, marginBottom: 2 },
  weatherImpactBody: { fontSize: 10.5, fontWeight: '300', color: colors.textMid, lineHeight: 15 },
  // Tab content
  tabContent:  { paddingHorizontal: P, paddingTop: 2 },
  // Route cards
  routeCard:   { backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  routeCardSel: { borderWidth: 1.5, borderColor: colors.text },
  routeHeader: { flexDirection: 'row', alignItems: 'center', padding: 11, gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  rankBadge:   { width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText:    { fontSize: 9, fontWeight: '600' },
  routeName:   { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  diffBadge:   { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  diffText:    { fontSize: 9.5, fontWeight: '500' },
  routeDesc:   { fontSize: 11, fontWeight: '300', color: colors.textMid, paddingHorizontal: 11, paddingVertical: 6, lineHeight: 16, borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStats:  { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStat:   { flex: 1, padding: 9, borderRightWidth: 0.5, borderRightColor: '#f0ede8' },
  routeStatLabel: { fontSize: 7.5, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  routeStatValue: { fontSize: 14, fontWeight: '500', color: colors.text },
  routeDetail:    { padding: 11 },
  routeWhy:    { fontSize: 11.5, color: colors.textMid, lineHeight: 18, fontWeight: '300', marginBottom: 5 },
  routeMetaRow: { fontSize: 10.5, color: colors.textMid, fontWeight: '300', marginBottom: 3, lineHeight: 16 },
  routeMetaKey: { fontWeight: '500', color: colors.text },
  condTip:     { backgroundColor: colors.cautionLight, borderRadius: 5, padding: 6, marginTop: 5 },
  condTipText: { fontSize: 10, color: colors.caution, fontWeight: '300', lineHeight: 15 },
  weatherTip:  { backgroundColor: colors.blueLight, borderRadius: 5, padding: 6, marginTop: 2, marginBottom: 5 },
  weatherTipText: { fontSize: 10, color: colors.blue, fontWeight: '300', lineHeight: 15 },
  highlights:  { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  highlightChip: { backgroundColor: colors.bgDeep, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  highlightText: { fontSize: 9.5, color: colors.textMid, fontWeight: '300' },
  // Kit
  kitCard:     { backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  kitRow:      { flexDirection: 'row', alignItems: 'center', padding: 11, gap: 9 },
  kitRowBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  kitDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.good, flexShrink: 0 },
  kitText:     { fontSize: 13, fontWeight: '400', color: colors.text },
  emptyTab:    { fontSize: 12, fontWeight: '300', color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  dataSource:  { fontSize: 9.5, fontWeight: '300', color: colors.textFaint, textAlign: 'center', marginTop: 4, marginBottom: 8 },
});
