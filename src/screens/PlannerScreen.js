import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Animated, Keyboard, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import {
  SectionHeader, AlertBanner, PrimaryButton, ProgressBar,
  CampsiteCard, TabBar, Slider, SegmentedControl,
} from '../components/UI';
import MapSketch from '../components/MapSketch';
import { planPaddle, hasApiKey } from '../services/claudeService';
import { SKILL_LEVELS, getStravaTokens, fetchStravaActivities, inferSkillFromStrava } from '../services/stravaService';

const TRANSPORT_OPTIONS = ['Car', 'Public Transport'];

const DESIRED_STOPS = ['Coffee', 'Pub', 'Swim', 'Campsite', 'Picnic', 'Wildlife'];

const SKILL_OPTIONS = [
  { ...SKILL_LEVELS.BEGINNER, effort: 'Easy — flat water, gentle pace' },
  { ...SKILL_LEVELS.INTERMEDIATE, effort: 'Moderate — coastal or river, steady pace' },
  { ...SKILL_LEVELS.ADVANCED, effort: 'Hard — open water, challenging conditions' },
  { ...SKILL_LEVELS.EXPERT, effort: 'Expert — expedition-grade, all conditions' },
];

export default function PlannerScreen({ navigation }) {
  // Structured inputs
  const [destination, setDestination] = useState('');
  const [duration, setDuration]       = useState(3);       // hours (1-8)
  const [transport, setTransport]     = useState('Car');
  const [selectedStops, setSelectedStops] = useState([]);
  const [skillLevel, setSkillLevel]   = useState(SKILL_LEVELS.INTERMEDIATE);
  const [previousPaddle, setPreviousPaddle] = useState(null); // Strava-inferred info
  const [stravaLoaded, setStravaLoaded] = useState(false);

  // Legacy prompt for free-text fallback
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [plan, setPlan] = useState(null);
  const [activeTab, setActiveTab] = useState('routes');
  // Index into the routes array — maps to the three route styles
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // Which route card is expanded (or -1 for none)
  const [expandedRoute, setExpandedRoute] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const loadingMsgRef = useRef(null);

  // Pre-fill destination with GPS location
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
        if (label && !destination) setDestination(label);
      } catch { /* ignore */ }
    })();
  }, []);

  // Load Strava skill inference if connected
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

  const toggleStop = (stop) => {
    setSelectedStops(prev =>
      prev.includes(stop) ? prev.filter(s => s !== stop) : [...prev, stop]
    );
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

  const handleGenerate = async () => {
    Keyboard.dismiss();
    if (!destination.trim()) return;

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
    setLoadingMsg(LOADING_MESSAGES[0]);

    // Rotate loading messages while waiting
    let msgIdx = 0;
    loadingMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[msgIdx]);
    }, 4000);

    try {
      // Build enriched prompt with proficiency context
      let enrichedInput = input;
      if (proficiency) {
        const profStr = formatProficiencyForPrompt(proficiency);
        enrichedInput = `${input}\n\nPaddler proficiency: ${profStr}`;
      }
      if (tripType) {
        enrichedInput += `\nTrip type: ${tripType.label} (${tripType.sub})`;
      }

      const result = await planPaddle(enrichedInput);
      setPlan(result);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (e) {
      clearInterval(interval);
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
            {/* Destination input */}
            <SectionHeader>Destination / Region</SectionHeader>
            <View style={s.inputCard}>
              <TextInput
                style={s.input}
                value={destination}
                onChangeText={setDestination}
                placeholder="e.g. Axminster, Bristol, Lake District..."
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
              />
            </View>

            {/* Duration slider */}
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
          {destination} {'\u00b7'} {duration}h {'\u00b7'} {skillLevel.label}
        </Text>
        <View style={{ width: 200, marginTop: 8 }}>
          <ProgressBar
            startLabel="Analysing"
            endLabel="Done"
            pct={loadingPct}
            color={colors.good}
          />
        </View>
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

        {/* Map */}
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
          overlayTitle={plan.understood}
          overlayMeta={`${plan.location?.base} \u00b7 ${(plan.trip?.type || '').replace('_', ' ')} \u00b7 ${plan.conditions?.skillLevel || 'intermediate'}`}
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
            ['Type', (plan.trip?.type || '\u2014').replace('_', ' ')],
            ['Skill', plan.conditions?.skillLevel || '\u2014'],
          ].map(([label, value], i) => (
            <View key={label} style={[s.summaryCell, i < 2 && s.summaryCellBorder]}>
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
                    {routes[i].estimated_duration ? ` · ${routes[i].estimated_duration}h` : ''}
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
                        ['Distance', r.distanceKm ? `${r.distanceKm} km` : '—'],
                        ['Time', r.estimated_duration ? `~${r.estimated_duration}h` : r.durationHours ? `~${r.durationHours}h` : '—'],
                        ['Terrain', r.terrain || '—'],
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
                            <Text style={s.weatherTipText}>🌤️ {r.weather_impact_summary}</Text>
                          </View>
                        ) : null}

                        {r.launchPoint ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Launch  </Text>{r.launchPoint}</Text> : null}
                        {r.travelFromBase ? <Text style={s.routeMetaRow}><Text style={s.routeMetaKey}>Travel  </Text>{r.travelFromBase} · {r.travelTimeMin} min</Text> : null}
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
  inputCard:  { marginHorizontal: P, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: P, marginBottom: P, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  input:      { fontSize: 13, fontWeight: '400', color: colors.text, lineHeight: 20, minHeight: 36 },
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
