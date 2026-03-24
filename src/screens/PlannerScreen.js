import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Animated, Keyboard, Alert, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import {
  SectionHeader, AlertBanner, ProgressBar, SegmentedControl,
} from '../components/UI';
import PaddleMap from '../components/PaddleMap';
import ConditionsTimeline from '../components/ConditionsTimeline';
import { gpxRouteBearing } from '../components/PaddleMap';
import { planPaddleWithWeather, hasApiKey } from '../services/claudeService';
import { SKILL_LEVELS, getStravaTokens, fetchStravaActivities, inferSkillFromStrava } from '../services/stravaService';
import { searchLocations, MIN_SEARCH_LENGTH, SEARCH_DEBOUNCE_MS } from '../services/geocodingService';
import { getWeatherWithCache } from '../services/weatherService';
import { saveRoute } from '../services/storageService';

// Native date picker — not available on web
let DateTimePicker = null;
if (Platform.OS !== 'web') {
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

const TRANSPORT_OPTIONS = ['Car', 'Public Transport'];
const DESIRED_STOPS = ['Coffee', 'Pub', 'Swim', 'Campsite', 'Picnic', 'Wildlife'];

const SKILL_OPTIONS = [
  { ...SKILL_LEVELS.BEGINNER,     effort: 'Easy — flat water, gentle pace' },
  { ...SKILL_LEVELS.INTERMEDIATE, effort: 'Moderate — coastal or river, steady pace' },
  { ...SKILL_LEVELS.ADVANCED,     effort: 'Hard — open water, challenging conditions' },
  { ...SKILL_LEVELS.EXPERT,       effort: 'Expert — expedition-grade, all conditions' },
];

// Hour options for the time window picker (6am → 9pm)
const HOURS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 6; // 6..21
  return { value: h, label: h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm` };
});

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6];

// Date strip: today through +21 days (22 chips)
const DATE_STRIP = (() => {
  const arr = [];
  const today = new Date();
  for (let i = 0; i <= 21; i++) {
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
  return !!dateStr && dateStr.length === 10;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
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
  return new Date(str + 'T12:00:00');
}

function dateToString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


export default function PlannerScreen({ navigation }) {
  // Date state
  const [tripDate, setTripDate]           = useState(getTodayString());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Time window state (hours, 24h)
  const [startHour, setStartHour]           = useState(9);  // 9am
  const [endHour, setEndHour]               = useState(17); // 5pm
  const [paddleDurationHrs, setPaddleDurationHrs] = useState(3);

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

  const weatherDates = useMemo(() => {
    if (!weatherData?.hourly) return new Set();
    return new Set(weatherData.hourly.map(h => h.time?.slice(0, 10)).filter(Boolean));
  }, [weatherData]);

  // Trip options
  const [transport, setTransport]         = useState('Car');
  const [selectedStops, setSelectedStops] = useState([]);
  const [skillLevel, setSkillLevel]       = useState(SKILL_LEVELS.INTERMEDIATE);
  const [previousPaddle, setPreviousPaddle] = useState(null);
  const [stravaLoaded, setStravaLoaded]   = useState(false);

  // Plan state
  const [, setPrompt]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [plan, setPlan]           = useState(null);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [expandedRoute, setExpandedRoute]       = useState(-1);
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const loadingMsgRef = useRef(null);

  // Save modal state
  const [saveModalRoute, setSaveModalRoute] = useState(null); // route obj being saved
  const [saveNameInput, setSaveNameInput]   = useState('');
  const [saving, setSaving]                 = useState(false);

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

  const toggleStop = (stop) => {
    setSelectedStops(prev => prev.includes(stop) ? prev.filter(s => s !== stop) : [...prev, stop]);
  };


  const buildPrompt = () => {
    const hrLabel = (h) => HOURS.find(x => x.value === h)?.label ?? `${h}:00`;
    const parts = [
      `I'm in ${destination} and am available from ${hrLabel(startHour)} to ${hrLabel(endHour)}`,
      `I want to paddle for approximately ${paddleDurationHrs} hour${paddleDurationHrs > 1 ? 's' : ''}`,
      `I have access to ${transport.toLowerCase()}`,
      `My skill level is ${skillLevel.label.toLowerCase()}`,
    ];
    if (selectedStops.length > 0) parts.push(`I'd like stops for: ${selectedStops.join(', ').toLowerCase()}`);
    if (previousPaddle) parts.push(`My last paddle was "${previousPaddle.name}" (${previousPaddle.distance} km on ${previousPaddle.date})`);
    return parts.join('. ') + '.';
  };

  const handleGenerate = async () => {
    Keyboard.dismiss();
    if (!destination.trim()) return;
if (startHour >= endHour) {
      Alert.alert('Invalid Time', 'End time must be after start time.');
      return;
    }

    const input = buildPrompt();
    setPrompt(input);
    setLoading(true);
    setPlan(null);
    fadeAnim.setValue(0);
    setSelectedRouteIdx(0);
    setExpandedRoute(-1);
    setLoadingPct(0);
    setLoadingMsg(LOADING_MESSAGES[0]);

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
        date: tripDate,
        durationHrs: paddleDurationHrs,
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
    setPlan(null); setPrompt(''); fadeAnim.setValue(0);
    setSelectedRouteIdx(0); setExpandedRoute(-1);
  };

  const difficultyColor = (d) => {
    const key = (d || '').toLowerCase();
    if (key === 'beginner' || key === 'easy') return { bg: colors.primaryLight, fg: colors.primary };
    if (key === 'intermediate' || key === 'moderate') return { bg: colors.primaryLight, fg: colors.primary };
    if (key === 'advanced' || key === 'challenging') return { bg: colors.cautionLight, fg: colors.caution };
    return { bg: colors.warnLight, fg: colors.warn };
  };

  const hrLabel = (h) => HOURS.find(x => x.value === h)?.label ?? `${h}:00`;

  // ── INPUT SCREEN ─────────────────────────────────────────────────────────
  if (!plan && !loading) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          <View style={s.nav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
              <Text style={s.backText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.navTitle}>Plan a Paddle</Text>
          </View>

          <ScrollView
            style={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.scrollContent}
          >
            {/* Location */}
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

            {/* Date */}
            <SectionHeader>Trip Date</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dateStrip}
            >
              {DATE_STRIP.map((dateStr) => {
                const isSelected = tripDate === dateStr;
                const hasWeather = weatherDates.has(dateStr);
                const isToday    = dateStr === getTodayString();
                const d          = new Date(dateStr + 'T12:00:00');
                const dayName    = d.toLocaleDateString('en', { weekday: 'short' });
                return (
                  <TouchableOpacity
                    key={dateStr}
                    style={[s.dateDayChip, isSelected && s.dateDayChipActive]}
                    onPress={() => setTripDate(dateStr)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.dateDayName, isSelected ? s.dateDayNameActive : isToday && s.dateDayToday]}>
                      {isToday ? 'Today' : dayName}
                    </Text>
                    <Text style={[s.dateDayNum, isSelected && s.dateDayNumActive]}>
                      {d.getDate()}
                    </Text>
                    <View style={[
                      s.weatherDot,
                      hasWeather
                        ? (isSelected ? s.weatherDotSelected : s.weatherDotActive)
                        : s.weatherDotNone,
                    ]} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* "Other date" fallback for dates beyond the strip */}
            {showDatePicker && Platform.OS !== 'web' && DateTimePicker && (
              <Modal transparent animationType="fade">
                <View style={s.dateModalBackdrop}>
                  <View style={s.dateModalCard}>
                    <View style={s.dateModalHeader}>
                      <Text style={s.dateModalTitle}>Pick a date</Text>
                      <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                        <Text style={s.dateModalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={dateStringToDate(tripDate)}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={(_, selected) => {
                        if (Platform.OS === 'android') setShowDatePicker(false);
                        if (selected) setTripDate(dateToString(selected));
                      }}
                    />
                  </View>
                </View>
              </Modal>
            )}
            {showDatePicker && Platform.OS === 'web' && (
              <TextInput
                style={s.dateInput}
                value={tripDate}
                onChangeText={(v) => { if (isDateValid(v)) { setTripDate(v); setShowDatePicker(false); } }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textFaint}
                maxLength={10}
                autoFocus
                onBlur={() => setShowDatePicker(false)}
              />
            )}
            <TouchableOpacity style={s.otherDateBtn} onPress={() => setShowDatePicker(true)}>
              <Text style={s.otherDateText}>Other date…</Text>
            </TouchableOpacity>

            {/* Time window */}
            <SectionHeader>Time Window</SectionHeader>
            <View style={s.timeWindowCard}>
              <View style={s.timeRow}>
                <View style={s.timeCol}>
                  <Text style={s.timeColLabel}>Start</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={s.timeChips}>
                      {HOURS.slice(0, 10).map(h => (
                        <TouchableOpacity
                          key={h.value}
                          style={[s.timeChip, startHour === h.value && s.timeChipActive]}
                          onPress={() => { setStartHour(h.value); if (h.value >= endHour) setEndHour(h.value + 1); }}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.timeChipText, startHour === h.value && s.timeChipTextActive]}>{h.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
              <View style={[s.timeRow, { marginTop: 8 }]}>
                <View style={s.timeCol}>
                  <Text style={s.timeColLabel}>End</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={s.timeChips}>
                      {HOURS.slice(1).map(h => (
                        <TouchableOpacity
                          key={h.value}
                          style={[s.timeChip, endHour === h.value && s.timeChipActive, h.value <= startHour && s.timeChipDisabled]}
                          onPress={() => h.value > startHour && setEndHour(h.value)}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.timeChipText, endHour === h.value && s.timeChipTextActive]}>{h.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
              <View style={s.timeWindowSummary}>
                <Text style={s.timeWindowSummaryText}>
                  Available {hrLabel(startHour)} → {hrLabel(endHour)}
                </Text>
              </View>
            </View>

            {/* Paddle duration */}
            <SectionHeader>How long do you want to paddle?</SectionHeader>
            <View style={s.durationRow}>
              {DURATION_OPTIONS.map(h => (
                <TouchableOpacity
                  key={h}
                  style={[s.durationChip, paddleDurationHrs === h && s.durationChipActive]}
                  onPress={() => setPaddleDurationHrs(h)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.durationChipText, paddleDurationHrs === h && s.durationChipTextActive]}>
                    {h === 6 ? '6h+' : `${h}h`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Weather forecast */}
            {/* Conditions timeline — only when location + date are both set */}
            {locationCoords && tripDate && (
              <>
                <SectionHeader>Conditions</SectionHeader>
                {weatherLoading ? (
                  <View style={s.weatherCard}>
                    <Text style={s.weatherLoading}>Loading forecast…</Text>
                  </View>
                ) : weatherData && !weatherDates.has(tripDate) ? (
                  <View style={s.weatherCard}>
                    <Text style={s.weatherNoForecast}>No forecast available for this date — weather data covers the next 7 days.</Text>
                  </View>
                ) : weatherData ? (
                  <ConditionsTimeline
                    hourly={weatherData.hourly}
                    date={tripDate}
                    startHour={startHour}
                    endHour={endHour}
                  />
                ) : null}
              </>
            )}

            {/* Transport */}
            <SectionHeader>Getting there</SectionHeader>
            <SegmentedControl options={TRANSPORT_OPTIONS} value={transport} onChange={setTransport} />

            {/* Skill */}
            <SectionHeader>Paddling proficiency</SectionHeader>
            {previousPaddle && (
              <View style={s.previousPaddle}>
                <Text style={s.previousPaddleLabel}>Previous paddle</Text>
                <Text style={s.previousPaddleValue}>
                  {previousPaddle.name} · {previousPaddle.distance} km · {previousPaddle.date}
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
                  <Text style={s.skillMeta}>Max {sk.maxWindKnots} kts · {sk.maxDistKm} km/day</Text>
                </TouchableOpacity>
              ))}
            </View>
            {stravaLoaded && <Text style={s.stravaNote}>Skill auto-detected from Strava</Text>}

            {/* Stops */}
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
              <Text style={s.generateBtnText}>Generate Trip →</Text>
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
        <View style={s.logoBadge}><Text style={s.logoEmoji}>🛶</Text></View>
        <Text style={s.loadTitle}>Planning your paddle…</Text>
        <Text style={s.loadPrompt} numberOfLines={2}>
          {destination} · {formatDateLabel(tripDate)} · {hrLabel(startHour)}–{hrLabel(endHour)} · {skillLevel.label}
        </Text>
        <View style={{ width: 200, marginTop: 8 }}>
          <ProgressBar startLabel="Analysing" endLabel="Done" pct={loadingPct} color={colors.primary} />
        </View>
        <Text style={s.loadStep}>{loadingMsg}</Text>
        <View style={s.dotsRow}>
          <LoadDot delay={0} /><LoadDot delay={200} /><LoadDot delay={400} />
        </View>
      </View>
    );
  }

  // ── RESULTS ───────────────────────────────────────────────────────────────
  const routes  = plan.routes  || [];
  const packing = plan.packingHighlights || [];
  const sel     = routes[selectedRouteIdx] || {};

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={reset} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>{plan.location?.base || 'Your Paddle'}</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{routes.length}</Text>
          </View>
        </View>

        {/* ══ PINNED HEADER — map + selector + description + strip ══ */}

        {/* Map */}
        <View>
          <PaddleMap
            height={200}
            coords={locationCoords ? { lat: locationCoords.lat, lon: locationCoords.lng } : undefined}
            routes={routes}
            selectedIdx={selectedRouteIdx}
            overlayTitle={sel.name}
            overlayMeta={sel.launchPoint || plan.location?.base}
          />
          {sel.travelTimeMin > 0 && (
            <View style={s.driveBadge}>
              <Text style={s.driveBadgeText}>🚗 {sel.travelTimeMin} min drive</Text>
            </View>
          )}
        </View>

        {/* Route selector */}
        <View style={s.routeSelector}>
          {routes.map((r, i) => {
            const active = selectedRouteIdx === i;
            return (
              <TouchableOpacity
                key={i}
                style={[s.routeSelectorTab, active && s.routeSelectorTabActive]}
                onPress={() => { setSelectedRouteIdx(i); setExpandedRoute(-1); }}
                activeOpacity={0.75}
              >
                <Text style={[s.routeSelectorNum, active && s.routeSelectorNumActive]}>{i + 1}</Text>
                <Text style={[s.routeSelectorName, active && s.routeSelectorNameActive]} numberOfLines={1}>{r.name}</Text>
                {r.distanceKm ? <Text style={[s.routeSelectorMeta, active && s.routeSelectorMetaActive]}>{r.distanceKm} km</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ══ SCROLLABLE — route detail, summary, weather, kit ══ */}
        <Animated.ScrollView
          style={{ opacity: fadeAnim, flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Selected route detail card ── */}
          {(() => {
            const r        = sel;
            const dc       = difficultyColor(r.difficulty_rating || r.difficulty);
            const expanded = expandedRoute === selectedRouteIdx;
            return (
              <View style={s.routeCard}>
                <TouchableOpacity
                  style={s.routeHeader}
                  onPress={() => setExpandedRoute(expanded ? -1 : selectedRouteIdx)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.routeName}>{r.name}</Text>
                    {r.description ? (
                      <Text style={s.routeDescInline} numberOfLines={expanded ? 0 : 2}>{r.description}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[s.diffBadge, { backgroundColor: dc.bg }]}>
                      <Text style={[s.diffText, { color: dc.fg }]}>{r.difficulty_rating || r.difficulty}</Text>
                    </View>
                    <Text style={s.descToggle}>{expanded ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>

                <View style={s.routeStats}>
                  {[
                    ['Distance', r.distanceKm ? `${r.distanceKm} km` : '—'],
                    ['Time',     r.estimated_duration ? `~${r.estimated_duration}h` : '—'],
                    ['Terrain',  r.terrain || '—'],
                  ].map(([l, v], si) => (
                    <View key={l} style={[s.routeStat, si < 2 && { borderRightWidth: 0.5, borderRightColor: '#f0ede8' }]}>
                      <Text style={s.routeStatLabel}>{l}</Text>
                      <Text style={s.routeStatValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {expanded && (
                  <View style={s.routeDetail}>
                    {r.why ? <Text style={s.routeWhy}>{r.why}</Text> : null}
                    {r.weather_impact_summary ? (
                      <View style={s.weatherTip}><Text style={s.weatherTipText}>{r.weather_impact_summary}</Text></View>
                    ) : null}
                    {r.launchPoint ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Launch  </Text>{r.launchPoint}</Text> : null}
                    {r.travelFromBase ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Travel  </Text>{r.travelFromBase}{r.travelTimeMin ? ` · ${r.travelTimeMin} min` : ''}</Text> : null}
                    {r.bestConditions ? <View style={s.condTip}><Text style={s.condTipText}>{r.bestConditions}</Text></View> : null}
                    {r.highlights?.length > 0 && (
                      <View style={s.highlights}>
                        {r.highlights.map((h) => (
                          <View key={h} style={s.highlightChip}><Text style={s.highlightText}>{h}</Text></View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <TouchableOpacity
                  style={s.saveRouteBtn}
                  onPress={() => {
                    setSaveModalRoute({ ...r, location: plan.location?.base || destination, locationCoords });
                    setSaveNameInput(r.name || '');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.saveRouteBtnText}>+ Save Route</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* ── Summary strip ── */}
          <View style={s.summaryStrip}>
            {[
              ['Date',   formatDateLabel(tripDate)],
              ['Window', `${hrLabel(startHour)}–${hrLabel(endHour)}`],
              ['Skill',  plan.conditions?.skillLevel || '—'],
            ].map(([label, value], i) => (
              <View key={label} style={[s.summaryCell, i < 2 && s.summaryCellBorder]}>
                <Text style={s.summaryCellLabel}>{label}</Text>
                <Text style={s.summaryCellValue}>{value}</Text>
              </View>
            ))}
          </View>

          {/* ── Weather through the day ── */}
          {plan._weather?.hourly && plan._weather.hourly.length > 0 && (
            <ConditionsTimeline
              hourly={plan._weather.hourly}
              date={tripDate}
              startHour={startHour}
              endHour={endHour}
              routeBearing={gpxRouteBearing(routes[selectedRouteIdx]?.waypoints)}
            />
          )}

          {plan.weatherNote && <AlertBanner type="caution" title="Weather" body={plan.weatherNote} />}
          {plan.safetyNote  && <AlertBanner type="warn"    title="Safety"  body={plan.safetyNote}  />}

          {packing.length > 0 && (
            <>
              <SectionHeader>Kit List</SectionHeader>
              <View style={[s.kitCard, { marginHorizontal: P }]}>
                {packing.map((item, i) => (
                  <View key={i} style={[s.kitRow, i < packing.length - 1 && s.kitRowBorder]}>
                    <View style={s.kitDot} />
                    <Text style={s.kitText}>{item}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={{ height: 48 }} />
        </Animated.ScrollView>

        {/* ══ Save Route modal ══ */}
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
                placeholder="Route name…"
                placeholderTextColor={colors.textFaint}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={async () => {
                  if (!saveNameInput.trim() || !saveModalRoute || saving) return;
                  setSaving(true);
                  try {
                    await saveRoute(saveModalRoute, saveNameInput.trim());
                    setSaveModalRoute(null);
                    Alert.alert('Saved', `"${saveNameInput.trim()}" added to your routes.`);
                  } catch { Alert.alert('Error', 'Could not save — please try again.'); }
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
                      await saveRoute(saveModalRoute, saveNameInput.trim());
                      setSaveModalRoute(null);
                      Alert.alert('Saved', `"${saveNameInput.trim()}" added to your routes.`);
                    } catch { Alert.alert('Error', 'Could not save — please try again.'); }
                    finally { setSaving(false); }
                  }}
                >
                  <Text style={s.modalSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
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

const P = 12;
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  safe:       { flex: 1 },
  centered:   { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:   { fontSize: 22, color: colors.primary },
  navTitle:   { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  countBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  countText:  { fontSize: 10, fontWeight: '600', color: '#fff' },
  scroll:     { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  inputCard:  { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: P, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  input:      { fontSize: 13, fontWeight: '400', color: colors.text, lineHeight: 20, minHeight: 36 },
  searchHint: { fontSize: 9, fontWeight: '300', color: colors.textMuted, marginTop: 4 },

  searchResults: { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, overflow: 'hidden' },
  searchResultItem: { paddingHorizontal: 12, paddingVertical: 10 },
  searchResultBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  searchResultLabel: { fontSize: 12, fontWeight: '500', color: colors.text, marginBottom: 2 },
  searchResultDetail: { fontSize: 10, fontWeight: '300', color: colors.textMuted },

  coordsBadge: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.primaryLight, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  coordsText:  { fontSize: 9, fontWeight: '400', color: colors.primary },

  // Date strip
  dateStrip:         { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingBottom: 8 },
  dateDayChip:       { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minWidth: 48 },
  dateDayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDayName:       { fontSize: 9, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  dateDayNameActive: { color: 'rgba(255,255,255,0.75)' },
  dateDayToday:      { color: colors.primary, fontWeight: '600' },
  dateDayNum:        { fontSize: 15, fontWeight: '500', color: colors.text, lineHeight: 18 },
  dateDayNumActive:  { color: '#fff' },
  weatherDot:        { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  weatherDotActive:  { backgroundColor: colors.primary },
  weatherDotSelected:{ backgroundColor: 'rgba(255,255,255,0.6)' },
  weatherDotNone:    { backgroundColor: colors.borderLight },
  otherDateBtn:      { marginHorizontal: P, marginBottom: 4, alignSelf: 'flex-start' },
  otherDateText:     { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  dateInput:         { fontSize: 13, fontWeight: '400', color: colors.text, minHeight: 36, marginHorizontal: P, backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8 },
  dateModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  dateModalCard:     { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 32 },
  dateModalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dateModalTitle:    { fontSize: 13, fontWeight: '500', color: colors.text },
  dateModalDone:     { fontSize: 14, fontWeight: '600', color: colors.primary },

  // Time window
  timeWindowCard:  { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  timeRow:         { },
  timeCol:         { },
  timeColLabel:    { fontSize: 9, fontWeight: '500', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  timeChips:       { flexDirection: 'row', gap: 5 },
  timeChip:        { backgroundColor: colors.bgDeep, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  timeChipActive:  { backgroundColor: colors.primary },
  timeChipDisabled:{ opacity: 0.35 },
  timeChipText:    { fontSize: 11, fontWeight: '400', color: colors.textMid },
  timeChipTextActive: { color: '#fff', fontWeight: '500' },
  timeWindowSummary: { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  timeWindowSummaryText: { fontSize: 12, fontWeight: '500', color: colors.primary, textAlign: 'center' },

  // Weather card
  weatherCard:     { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, padding: 10, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  weatherLoading:     { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  weatherNoForecast:  { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  weatherRow:      { flexDirection: 'row', marginBottom: 6 },
  weatherCell:     { flex: 1, alignItems: 'center' },
  weatherCellLabel:{ fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  weatherCellValue:{ fontSize: 11, fontWeight: '500', color: colors.text },
  safetyBar:       { height: 3, backgroundColor: colors.borderLight, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  safetyFill:      { height: '100%', borderRadius: 2 },
  safetyScore:     { fontSize: 9, fontWeight: '300', color: colors.textMuted, textAlign: 'center', marginTop: 3 },

  // Skill
  skillGrid:       { marginHorizontal: P, flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  skillCard:       { width: '48%', backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.borderLight, padding: 9, flexGrow: 1, flexBasis: '45%' },
  skillCardActive: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryLight },
  skillLabel:      { fontSize: 12, fontWeight: '500', color: colors.text, marginBottom: 2 },
  skillLabelActive:{ color: colors.primary, fontWeight: '600' },
  skillEffort:     { fontSize: 10, fontWeight: '300', color: colors.textMid, marginBottom: 2, lineHeight: 14 },
  skillMeta:       { fontSize: 8.5, fontWeight: '300', color: colors.textMuted },
  stravaNote:      { fontSize: 10, fontWeight: '300', color: colors.primary, marginHorizontal: P, marginBottom: 8, fontStyle: 'italic' },

  previousPaddle:      { marginHorizontal: P, marginBottom: 6, backgroundColor: colors.primaryLight, borderRadius: 7, padding: 8, paddingHorizontal: 10 },
  previousPaddleLabel: { fontSize: 9, fontWeight: '500', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  previousPaddleValue: { fontSize: 11, fontWeight: '300', color: colors.text, lineHeight: 16 },

  stopsWrap:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: P, marginBottom: 8 },
  stopChip:        { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  stopChipActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
  stopChipText:    { fontSize: 12, fontWeight: '400', color: colors.textMid },
  stopChipTextActive: { color: '#fff', fontWeight: '500' },

  generateBtn:         { marginHorizontal: P, marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  generateBtnDisabled: { backgroundColor: '#c8c4bc', shadowOpacity: 0 },
  generateBtnText:     { fontSize: 14, fontWeight: '500', color: '#fff' },

  logoBadge:  { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  logoEmoji:  { fontSize: 24 },
  loadTitle:  { fontSize: 14, fontWeight: '400', color: colors.textMid },
  loadPrompt: { fontSize: 11, fontWeight: '300', color: colors.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 18 },
  loadStep:   { fontSize: 11, fontWeight: '400', color: colors.primary, textAlign: 'center', marginTop: 2 },
  dotsRow:    { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },

  // Results
  driveBadge:     { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  driveBadgeText: { fontSize: 11, fontWeight: '500', color: colors.text },

  summaryStrip:     { flexDirection: 'row', marginHorizontal: P, marginVertical: 8, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  summaryCell:      { flex: 1, paddingVertical: 9, alignItems: 'center' },
  summaryCellBorder:{ borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  summaryCellLabel: { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  summaryCellValue: { fontSize: 11, fontWeight: '500', color: colors.text, textTransform: 'capitalize' },

  routeStyleBar:      { flexDirection: 'row', marginHorizontal: P, marginBottom: 4, backgroundColor: '#e1e0db', borderRadius: 8, padding: 2, gap: 2 },
  routeStyleTab:      { flex: 1, padding: 8, alignItems: 'center', borderRadius: 6 },
  routeStyleTabActive:{ backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  routeStyleLabel:    { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  routeStyleLabelActive: { fontWeight: '600', color: colors.text },
  routeStyleMeta:     { fontSize: 9, fontWeight: '300', color: colors.textFaint, marginTop: 1 },
  routeStyleMetaActive: { color: colors.textMid },

  weatherImpact:     { marginHorizontal: P, marginBottom: 4, backgroundColor: colors.primaryLight, borderRadius: 8, padding: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.borderLight },
  weatherImpactTitle:{ fontSize: 10, fontWeight: '600', color: colors.primary, marginBottom: 2 },
  weatherImpactBody: { fontSize: 10.5, fontWeight: '300', color: colors.textMid, lineHeight: 15 },

  tabContent:  { paddingHorizontal: P, paddingTop: 2 },
  routeCard:   { backgroundColor: colors.white, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.borderLight, overflow: 'hidden' },
  routeCardSel:{ borderWidth: 1.5, borderColor: colors.primary },
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
  routeDetail: { padding: 11 },
  routeWhy:    { fontSize: 11.5, color: colors.textMid, lineHeight: 18, fontWeight: '300', marginBottom: 5 },
  routeMetaRow:{ fontSize: 10.5, color: colors.textMid, fontWeight: '300', marginBottom: 3, lineHeight: 16 },
  routeMetaKey:{ fontWeight: '500', color: colors.text },
  condTip:     { backgroundColor: colors.cautionLight, borderRadius: 5, padding: 6, marginTop: 5 },
  condTipText: { fontSize: 10, color: colors.caution, fontWeight: '300', lineHeight: 15 },
  weatherTip:  { backgroundColor: colors.primaryLight, borderRadius: 5, padding: 6, marginTop: 2, marginBottom: 5 },
  weatherTipText: { fontSize: 10, color: colors.primary, fontWeight: '300', lineHeight: 15 },
  highlights:  { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  highlightChip: { backgroundColor: colors.bgDeep, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  highlightText: { fontSize: 9.5, color: colors.textMid, fontWeight: '300' },

  kitCard:     { backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', marginBottom: 8 },
  kitRow:      { flexDirection: 'row', alignItems: 'center', padding: 11, gap: 9 },
  kitRowBorder:{ borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  kitDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  kitText:     { fontSize: 13, fontWeight: '400', color: colors.text },
  emptyTab:    { fontSize: 12, fontWeight: '300', color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  dataSource:  { fontSize: 9.5, fontWeight: '300', color: colors.textFaint, textAlign: 'center', marginTop: 4, marginBottom: 8 },

  descBar:               { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: P, paddingVertical: 8, backgroundColor: colors.primaryLight, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 6 },
  descText:              { flex: 1, fontSize: 12, fontWeight: '300', color: colors.textMid, lineHeight: 17 },
  descToggle:            { fontSize: 9, color: colors.textMuted, paddingTop: 2 },

  routeSelector:         { flexDirection: 'row', gap: 6, paddingHorizontal: P, paddingVertical: 8, backgroundColor: colors.white, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  routeSelectorTab:      { flex: 1, backgroundColor: colors.bgDeep, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 8, alignItems: 'center' },
  routeSelectorTabActive:{ backgroundColor: colors.primary },
  routeSelectorNum:      { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginBottom: 2 },
  routeSelectorNumActive:{ color: 'rgba(255,255,255,0.75)' },
  routeSelectorName:     { fontSize: 11, fontWeight: '500', color: colors.text, textAlign: 'center' },
  routeSelectorNameActive:{ color: '#fff' },
  routeSelectorMeta:     { fontSize: 9, fontWeight: '300', color: colors.textMuted, marginTop: 1 },
  routeSelectorMetaActive:{ color: 'rgba(255,255,255,0.65)' },

  routesList:       { paddingHorizontal: P, paddingTop: 2 },
  routeDescInline:  { fontSize: 11, fontWeight: '300', color: colors.textMid, marginTop: 2, lineHeight: 15 },
  onMapLabel:       { fontSize: 8.5, fontWeight: '500', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },

  saveRouteBtn:     { margin: 10, marginTop: 0, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveRouteBtnText: { fontSize: 14, fontWeight: '600', color: '#fff', letterSpacing: 0.2 },

  // Duration picker
  durationRow:      { flexDirection: 'row', gap: 8, marginHorizontal: P, marginBottom: 8, flexWrap: 'wrap' },
  durationChip:     { flex: 1, minWidth: 48, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 9, alignItems: 'center' },
  durationChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  durationChipText:   { fontSize: 13, fontWeight: '500', color: colors.textMid },
  durationChipTextActive: { color: '#fff', fontWeight: '600' },

  // Save modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard:     { width: '100%', backgroundColor: colors.white, borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  modalTitle:    { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 4 },
  modalSub:      { fontSize: 12, fontWeight: '400', color: colors.textMuted, marginBottom: 16, lineHeight: 17 },
  modalInput:    { backgroundColor: colors.bgDeep, borderRadius: 10, borderWidth: 1, borderColor: colors.border, fontSize: 14, fontWeight: '400', color: colors.text, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  modalBtns:     { flexDirection: 'row', gap: 10 },
  modalCancel:   { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '500', color: colors.textMid },
  modalSave:        { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  modalSaveDisabled:{ backgroundColor: '#c8c4bc' },
  modalSaveText:    { fontSize: 14, fontWeight: '600', color: '#fff' },
});
