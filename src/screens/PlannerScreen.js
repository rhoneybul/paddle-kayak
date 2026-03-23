import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Animated, Keyboard, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { SheetHandle, SectionHeader, AlertBanner, PrimaryButton, CampsiteCard, TabBar } from '../components/UI';
import MapSketch from '../components/MapSketch';
import { planPaddleWithWeather, hasApiKey } from '../services/claudeService';

const EXAMPLES = [
  "I'm in Axminster and want to go for a day paddle tomorrow for about 2 hours",
  "I'm in London with a car — where can I go for a day paddle?",
  "Planning a weekend trip, want to kayak and camp. Based in Bristol",
  "I'm near Sydney, complete beginner, want a gentle 2-hour paddle",
  "I want to plan a week-long kayak expedition. Based in the Scottish Highlands",
];

/** Route-style labels for the three-tab selector (Scenic / Fast / Coastal). */
const ROUTE_STYLE_LABELS = ['Scenic', 'Fast', 'Coastal'];

/** Map a difficulty_rating value to a colour key used by the existing theme. */
function difficultyColor(rating) {
  if (rating === 'beginner') return { bg: colors.goodLight, fg: colors.good };
  if (rating === 'intermediate') return { bg: colors.blueLight, fg: colors.blue };
  if (rating === 'advanced') return { bg: colors.cautionLight, fg: colors.caution };
  if (rating === 'expert') return { bg: colors.warnLight, fg: colors.warn };
  // Fallback for legacy "easy | moderate | challenging" values
  if (rating === 'easy') return { bg: colors.goodLight, fg: colors.good };
  if (rating === 'moderate') return { bg: colors.cautionLight, fg: colors.caution };
  return { bg: colors.warnLight, fg: colors.warn };
}

/** Loading-progress messages shown in sequence while waiting for Claude. */
const LOADING_MESSAGES = [
  'Analysing weather conditions…',
  'Finding the best routes…',
  'Mapping waypoints…',
  'Almost there…',
];

export default function PlannerScreen({ navigation }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [plan, setPlan] = useState(null);
  const [activeTab, setActiveTab] = useState('routes');
  // Index into the routes array — maps to the three route styles
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // Which route card is expanded (or -1 for none)
  const [expandedRoute, setExpandedRoute] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const loadingMsgRef = useRef(null);

  const handlePlan = async (text) => {
    const input = (text || prompt).trim();
    if (!input) return;
    Keyboard.dismiss();

    if (!hasApiKey()) {
      Alert.alert(
        'API Key Required',
        'Add your Claude API key to .env:\n\nEXPO_PUBLIC_CLAUDE_API_KEY=sk-ant-...\n\nGet a free key at console.anthropic.com',
      );
      return;
    }

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
      const result = await planPaddleWithWeather({ prompt: input });
      setPlan(result);
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

  // ── INPUT ─────────────────────────────────────────────────────────────────
  if (!plan && !loading) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.safe}>
          {/* Subtle map bg */}
          <View style={s.mapBg}>
            <View style={s.mapWater} />
            <View style={s.mapLand1} />
            <View style={s.mapLand2} />
            <View style={s.mapGreen} />
            <View style={s.mapFade} />
          </View>

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
            {/* Logo mark */}
            <View style={s.logoWrap}>
              <View style={s.logoBadge}>
                <Text style={s.logoEmoji}>🛶</Text>
              </View>
              <Text style={s.logoSub}>Describe your paddle in plain English</Text>
            </View>

            {/* Input card */}
            <View style={s.inputCard}>
              <TextInput
                style={s.input}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={`e.g. I'm in Axminster and want a 2-hour day paddle tomorrow…`}
                placeholderTextColor={colors.textFaint}
                multiline
                numberOfLines={3}
                returnKeyType="done"
                onSubmitEditing={() => handlePlan()}
                autoFocus
              />
              <TouchableOpacity
                style={[s.planBtn, !prompt.trim() && s.planBtnDisabled]}
                onPress={() => handlePlan()}
                disabled={!prompt.trim()}
                activeOpacity={0.85}
              >
                <Text style={s.planBtnText}>Plan →</Text>
              </TouchableOpacity>
            </View>

            {/* Examples */}
            <Text style={s.examplesLabel}>Try an example</Text>
            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity
                key={i}
                style={s.exampleChip}
                onPress={() => { setPrompt(ex); handlePlan(ex); }}
                activeOpacity={0.7}
              >
                <Text style={s.exampleText}>{ex}</Text>
              </TouchableOpacity>
            ))}

            {!hasApiKey() && (
              <View style={s.keyWarning}>
                <Text style={s.keyWarningText}>
                  ⚠️  Add EXPO_PUBLIC_CLAUDE_API_KEY to your .env to enable AI planning.{'\n'}
                  Free key at console.anthropic.com
                </Text>
              </View>
            )}
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
        <Text style={s.loadPrompt} numberOfLines={2}>"{prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt}"</Text>
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
            <Text style={s.backText}>‹</Text>
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
          overlayMeta={`${plan.location?.base} · ${(plan.trip?.type || '').replace('_', ' ')} · ${plan.conditions?.skillLevel || 'intermediate'}`}
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
            ['Base', plan.location?.base || '—'],
            ['Type', (plan.trip?.type || '—').replace('_', ' ')],
            ['Skill', plan.conditions?.skillLevel || '—'],
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

          {/* ── ROUTES TAB ── */}
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
                label="Check Conditions & Start →"
                onPress={() => navigation.navigate('Weather', { planResult: plan, selectedRoute: sel })}
                style={{ marginTop: 4 }}
              />
            </View>
          )}

          {/* ── CAMPSITES TAB ── */}
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

          {/* ── KIT TAB ── */}
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
  // Map background for input state
  mapBg:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  mapWater: { position: 'absolute', inset: 0, backgroundColor: colors.mapWater, opacity: 0.35 },
  mapLand1: { position: 'absolute', top: 0, left: 0, width: 110, height: 220, borderBottomRightRadius: 36, backgroundColor: colors.mapLand, opacity: 0.3 },
  mapLand2: { position: 'absolute', top: 0, right: 0, width: 90, height: 185, borderBottomLeftRadius: 28, backgroundColor: colors.mapLand, opacity: 0.25 },
  mapGreen: { position: 'absolute', top: 18, left: 14, width: 58, height: 48, borderRadius: 7, backgroundColor: colors.mapGreen, opacity: 0.4 },
  mapFade:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, opacity: 0.45 },
  // Nav
  nav:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:   { fontSize: 22, color: colors.good },
  navTitle:   { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  countBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  countText:  { fontSize: 10, fontWeight: '600', color: colors.bg },
  scroll:     { flex: 1 },
  scrollContent: { paddingHorizontal: P },
  // Logo
  logoWrap:   { alignItems: 'center', paddingTop: 36, paddingBottom: 24 },
  logoBadge:  { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  logoEmoji:  { fontSize: 24 },
  logoSub:    { fontSize: 12, fontWeight: '300', color: colors.textMuted },
  // Input
  inputCard:  { backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: P, marginBottom: P, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  input:      { fontSize: 13, fontWeight: '300', color: colors.text, lineHeight: 20, minHeight: 64, textAlignVertical: 'top', marginBottom: 8 },
  planBtn:    { backgroundColor: colors.text, borderRadius: 8, padding: 10, alignItems: 'center', alignSelf: 'flex-end', paddingHorizontal: 20 },
  planBtnDisabled: { backgroundColor: '#c8c4bc' },
  planBtnText: { fontSize: 13, fontWeight: '500', color: colors.bg },
  // Examples
  examplesLabel: { fontSize: 9, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  exampleChip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 6 },
  exampleText: { fontSize: 12, fontWeight: '300', color: colors.textMid, lineHeight: 18 },
  keyWarning: { backgroundColor: colors.cautionLight, borderWidth: 1, borderColor: colors.cautionBorder, borderRadius: 8, padding: P, marginTop: 8 },
  keyWarningText: { fontSize: 11, fontWeight: '300', color: '#6a5a2a', lineHeight: 18 },
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
