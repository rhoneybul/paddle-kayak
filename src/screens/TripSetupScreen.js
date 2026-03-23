import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { SectionHeader, PrimaryButton, AlertBanner, GhostButton } from '../components/UI';
import {
  SKILL_LEVELS, EFFORT_LEVELS,
  buildProficiency, analyseStravaActivities, formatProficiencyForPrompt,
  isStravaConfigured, connectStrava, fetchStravaActivities,
  getStravaTokens, getStravaAthlete, disconnectStrava,
} from '../services/stravaService';
import api from '../services/api';

const TRIP_TYPES = [
  { id: 'day_paddle', label: 'Day Trip', sub: 'Back before dark', days: 1 },
  { id: 'multi_day',  label: 'Multi-Day', sub: '2+ days, camping', days: 3 },
];

const PROFICIENCY_MODES = [
  { key: 'manual', label: 'Manual Entry' },
  { key: 'strava', label: 'Strava Sync' },
];

export default function TripSetupScreen({ navigation }) {
  const [tripType, setTripType] = useState(TRIP_TYPES[0]);

  // Proficiency mode toggle
  const [proficiencyMode, setProficiencyMode] = useState('manual');

  // Manual entry fields
  const [manualDistance, setManualDistance] = useState('');
  const [manualHours, setManualHours]     = useState('');
  const [manualMinutes, setManualMinutes] = useState('');
  const [manualEffort, setManualEffort]   = useState('medium');

  // Strava state
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaAthlete, setStravaAthlete]     = useState(null);
  const [stravaLoading, setStravaLoading]     = useState(false);
  const [stravaResult, setStravaResult]       = useState(null); // { proficiency, activities, bestActivity }
  const [stravaError, setStravaError]         = useState(null);

  // Computed proficiency (from either mode)
  const [proficiency, setProficiency] = useState(null);

  // Alert banner for Strava fallback
  const [fallbackBanner, setFallbackBanner] = useState(null);

  // ── Load existing Strava connection on mount ─────────────────────────────
  useEffect(() => {
    (async () => {
      if (!isStravaConfigured()) {
        if (proficiencyMode === 'strava') {
          setFallbackBanner({
            type: 'caution',
            title: 'Strava Unavailable',
            body: 'Strava API keys are not configured. Please use manual entry to set your proficiency.',
          });
          setProficiencyMode('manual');
        }
        return;
      }
      const tokens = await getStravaTokens();
      if (tokens) {
        setStravaConnected(true);
        const athlete = await getStravaAthlete();
        setStravaAthlete(athlete);
      }
    })();
  }, []);

  // ── Build proficiency when manual fields change ──────────────────────────
  useEffect(() => {
    if (proficiencyMode !== 'manual') return;
    const distKm = parseFloat(manualDistance);
    const hrs    = parseInt(manualHours || '0', 10);
    const mins   = parseInt(manualMinutes || '0', 10);
    const totalHrs = hrs + mins / 60;

    if (distKm > 0 && totalHrs > 0) {
      const p = buildProficiency({
        distanceKm:  distKm,
        durationHrs: totalHrs,
        effort:      manualEffort,
        source:      'manual',
      });
      setProficiency(p);
    } else {
      setProficiency(null);
    }
  }, [proficiencyMode, manualDistance, manualHours, manualMinutes, manualEffort]);

  // ── Use Strava result as proficiency when in strava mode ─────────────────
  useEffect(() => {
    if (proficiencyMode === 'strava' && stravaResult) {
      setProficiency(stravaResult.proficiency);
    }
  }, [proficiencyMode, stravaResult]);

  // ── Strava connect handler ───────────────────────────────────────────────
  const handleConnectStrava = useCallback(async () => {
    if (!isStravaConfigured()) {
      setFallbackBanner({
        type: 'caution',
        title: 'Strava Unavailable',
        body: 'Strava API keys are not configured. Please use manual entry instead.',
      });
      setProficiencyMode('manual');
      return;
    }

    setStravaLoading(true);
    setStravaError(null);
    setFallbackBanner(null);

    try {
      const athlete = await connectStrava();
      if (athlete) {
        setStravaConnected(true);
        setStravaAthlete(athlete);
        await syncStravaActivities();
      }
    } catch (err) {
      setStravaError(err.message);
      setFallbackBanner({
        type: 'warn',
        title: 'Strava Connection Failed',
        body: `${err.message}. You can still set your proficiency manually.`,
      });
      setProficiencyMode('manual');
    } finally {
      if (Platform.OS !== 'web') setStravaLoading(false);
    }
  }, []);

  // ── Fetch and analyse Strava activities ──────────────────────────────────
  const syncStravaActivities = useCallback(async () => {
    setStravaLoading(true);
    setStravaError(null);
    try {
      const activities = await fetchStravaActivities(50);
      if (!activities || activities.length === 0) {
        setStravaError('No paddling activities found on Strava.');
        setFallbackBanner({
          type: 'caution',
          title: 'No Paddle Activities',
          body: 'No kayaking/paddling activities found on Strava. Try manual entry or log some paddles first.',
        });
        return;
      }

      const result = analyseStravaActivities(activities);
      if (!result) {
        setStravaError('No paddling-type activities found.');
        setFallbackBanner({
          type: 'caution',
          title: 'No Paddle Activities',
          body: 'Your Strava activities don\'t include kayaking, canoeing, or paddling. Use manual entry instead.',
        });
        return;
      }

      setStravaResult(result);
      setFallbackBanner(null);
    } catch (err) {
      setStravaError(err.message);
      setFallbackBanner({
        type: 'warn',
        title: 'Sync Failed',
        body: `Could not fetch Strava activities: ${err.message}`,
      });
    } finally {
      setStravaLoading(false);
    }
  }, []);

  // ── Disconnect Strava ────────────────────────────────────────────────────
  const handleDisconnectStrava = useCallback(async () => {
    await disconnectStrava();
    setStravaConnected(false);
    setStravaAthlete(null);
    setStravaResult(null);
    setProficiency(null);
  }, []);

  // ── Mode switch handler ──────────────────────────────────────────────────
  const handleModeSwitch = useCallback((mode) => {
    setFallbackBanner(null);
    if (mode === 'strava' && !isStravaConfigured()) {
      setFallbackBanner({
        type: 'caution',
        title: 'Strava Unavailable',
        body: 'Strava API keys are not configured. Please use manual entry instead.',
      });
      return;
    }
    setProficiencyMode(mode);
  }, []);

  // ── Continue to Planner ──────────────────────────────────────────────────
  const handleContinue = async () => {
    // Save proficiency to profile (best-effort)
    try {
      await api.users.update({
        skill_level:     proficiency?.level || 'beginner',
        proficiency_data: proficiency || null,
      });
    } catch (_) { /* offline — will sync later */ }

    navigation.navigate('Planner', {
      tripType,
      proficiency: proficiency || buildProficiency({
        distanceKm: 5, durationHrs: 1, effort: 'medium', source: 'manual',
      }),
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Trip Setup</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* ── Trip type ──────────────────────────────────────────── */}
          <SectionHeader>Trip type</SectionHeader>
          <View style={s.card}>
            {TRIP_TYPES.map((t, i) => (
              <View key={t.id}>
                {i > 0 && <View style={s.sep} />}
                <TouchableOpacity style={s.row} onPress={() => setTripType(t)}>
                  <View style={s.rowMain}>
                    <Text style={[s.rowLabel, tripType.id === t.id && s.rowLabelSelected]}>{t.label}</Text>
                    <Text style={s.rowSub}>{t.sub}</Text>
                  </View>
                  {tripType.id === t.id && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* ── Proficiency mode toggle ────────────────────────────── */}
          <SectionHeader>Paddling proficiency</SectionHeader>
          <View style={s.segmentedControl}>
            {PROFICIENCY_MODES.map(m => (
              <TouchableOpacity
                key={m.key}
                style={[s.segment, proficiencyMode === m.key && s.segmentActive]}
                onPress={() => handleModeSwitch(m.key)}
              >
                <Text style={[s.segmentText, proficiencyMode === m.key && s.segmentTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Alert banner (Strava fallback / errors) ───────────── */}
          {fallbackBanner && (
            <AlertBanner
              type={fallbackBanner.type}
              title={fallbackBanner.title}
              body={fallbackBanner.body}
            />
          )}

          {/* ── Manual entry ───────────────────────────────────────── */}
          {proficiencyMode === 'manual' && (
            <View style={s.card}>
              <View style={s.formHeader}>
                <Text style={s.formTitle}>Your best paddle</Text>
                <Text style={s.formSubtitle}>Describe a previous paddle so we can suggest safe routes</Text>
              </View>
              <View style={s.sep} />

              {/* Distance */}
              <View style={s.formRow}>
                <Text style={s.formLabel}>Distance (km)</Text>
                <TextInput
                  style={s.formInput}
                  value={manualDistance}
                  onChangeText={setManualDistance}
                  placeholder="e.g. 10"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                  testID="manual-distance-input"
                />
              </View>
              <View style={s.sep} />

              {/* Duration */}
              <View style={s.formRow}>
                <Text style={s.formLabel}>Duration</Text>
                <View style={s.durationInputs}>
                  <TextInput
                    style={[s.formInput, s.durationField]}
                    value={manualHours}
                    onChangeText={setManualHours}
                    placeholder="0"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                    testID="manual-hours-input"
                  />
                  <Text style={s.durationLabel}>h</Text>
                  <TextInput
                    style={[s.formInput, s.durationField]}
                    value={manualMinutes}
                    onChangeText={setManualMinutes}
                    placeholder="0"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                    testID="manual-minutes-input"
                  />
                  <Text style={s.durationLabel}>min</Text>
                </View>
              </View>
              <View style={s.sep} />

              {/* Effort level */}
              <View style={s.formRow}>
                <Text style={s.formLabel}>Effort level</Text>
              </View>
              {EFFORT_LEVELS.map((e, i) => (
                <View key={e.key}>
                  {i > 0 && <View style={s.sep} />}
                  <TouchableOpacity
                    style={s.row}
                    onPress={() => setManualEffort(e.key)}
                    testID={`effort-${e.key}`}
                  >
                    <View style={s.rowMain}>
                      <Text style={[s.rowLabel, manualEffort === e.key && s.rowLabelSelected]}>{e.label}</Text>
                      <Text style={s.rowSub}>{e.description}</Text>
                    </View>
                    {manualEffort === e.key && <Text style={s.check}>✓</Text>}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ── Strava sync ────────────────────────────────────────── */}
          {proficiencyMode === 'strava' && (
            <View>
              {/* Connect / Status card */}
              <View style={s.card}>
                <View style={s.stravaHeader}>
                  <View style={s.stravaLogo}><Text style={s.stravaLogoText}>S</Text></View>
                  <View style={s.rowMain}>
                    <Text style={[s.rowLabel, s.rowLabelSelected]}>
                      {stravaConnected ? 'Strava Connected' : 'Connect Strava'}
                    </Text>
                    <Text style={s.rowSub}>
                      {stravaConnected && stravaAthlete
                        ? `${stravaAthlete.firstname} ${stravaAthlete.lastname}`
                        : 'Auto-detect proficiency from your paddle activities'
                      }
                    </Text>
                  </View>
                  {stravaConnected ? (
                    <View style={s.statusDotConnected} />
                  ) : (
                    <View style={s.statusDotDisconnected} />
                  )}
                </View>

                {stravaError && (
                  <View style={s.stravaErrorRow}>
                    <Text style={s.stravaErrorText}>{stravaError}</Text>
                  </View>
                )}

                <View style={s.sep} />

                {!stravaConnected ? (
                  <TouchableOpacity
                    style={s.stravaAction}
                    onPress={handleConnectStrava}
                    disabled={stravaLoading}
                  >
                    {stravaLoading ? (
                      <ActivityIndicator size="small" color="#fc4c02" />
                    ) : (
                      <Text style={s.stravaActionText}>Connect to Strava</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={s.stravaActions}>
                    <TouchableOpacity
                      style={s.stravaAction}
                      onPress={syncStravaActivities}
                      disabled={stravaLoading}
                    >
                      {stravaLoading ? (
                        <ActivityIndicator size="small" color="#fc4c02" />
                      ) : (
                        <Text style={s.stravaActionText}>
                          {stravaResult ? 'Re-sync Activities' : 'Sync Activities'}
                        </Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity style={s.stravaDisconnect} onPress={handleDisconnectStrava}>
                      <Text style={s.stravaDisconnectText}>Disconnect</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Strava results */}
              {stravaResult && (
                <View style={s.card}>
                  <View style={s.formHeader}>
                    <Text style={s.formTitle}>Best Paddle Detected</Text>
                    <Text style={s.formSubtitle}>
                      {stravaResult.bestActivity.name || 'Paddle activity'}
                    </Text>
                  </View>
                  <View style={s.sep} />
                  <View style={s.statsGrid}>
                    <View style={s.statCell}>
                      <Text style={s.statLabel}>Distance</Text>
                      <Text style={s.statValue}>{stravaResult.proficiency.distanceKm} km</Text>
                    </View>
                    <View style={[s.statCell, s.statCellBorder]}>
                      <Text style={s.statLabel}>Duration</Text>
                      <Text style={s.statValue}>{stravaResult.proficiency.durationHrs}h</Text>
                    </View>
                    <View style={[s.statCell, s.statCellBorder]}>
                      <Text style={s.statLabel}>Speed</Text>
                      <Text style={s.statValue}>{stravaResult.proficiency.speedKmh} km/h</Text>
                    </View>
                  </View>
                  <View style={s.sep} />
                  <View style={s.statsGrid}>
                    <View style={s.statCell}>
                      <Text style={s.statLabel}>Activities</Text>
                      <Text style={s.statValue}>{stravaResult.proficiency.stravaStats.totalActivities}</Text>
                    </View>
                    <View style={[s.statCell, s.statCellBorder]}>
                      <Text style={s.statLabel}>Total km</Text>
                      <Text style={s.statValue}>{stravaResult.proficiency.stravaStats.totalKm}</Text>
                    </View>
                    <View style={[s.statCell, s.statCellBorder]}>
                      <Text style={s.statLabel}>Level</Text>
                      <Text style={[s.statValue, { textTransform: 'capitalize' }]}>{stravaResult.proficiency.level}</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ── Proficiency summary ────────────────────────────────── */}
          {proficiency && (
            <View>
              <SectionHeader>Route constraints</SectionHeader>
              <View style={s.card}>
                <View style={s.constraintRow}>
                  <Text style={s.constraintLabel}>Based on</Text>
                  <Text style={s.constraintValue}>{proficiency.label}</Text>
                </View>
                <View style={s.sep} />
                <View style={s.statsGrid}>
                  <View style={s.statCell}>
                    <Text style={s.statLabel}>Max distance</Text>
                    <Text style={s.statValue}>{proficiency.maxDistKm} km/day</Text>
                  </View>
                  <View style={[s.statCell, s.statCellBorder]}>
                    <Text style={s.statLabel}>Max wind</Text>
                    <Text style={s.statValue}>{proficiency.maxWindKnots} kts</Text>
                  </View>
                  <View style={[s.statCell, s.statCellBorder]}>
                    <Text style={s.statLabel}>Max waves</Text>
                    <Text style={s.statValue}>{proficiency.maxWaveM} m</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ── Continue button ────────────────────────────────────── */}
          <PrimaryButton
            label="Plan My Paddle →"
            onPress={handleContinue}
            style={{ marginTop: 8 }}
          />
          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe:      { flex: 1 },
  nav:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:  { fontSize: 22, color: colors.good },
  navTitle:  { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },

  // Cards
  card: { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  row:  { flexDirection: 'row', alignItems: 'center', padding: 12, paddingVertical: 11, gap: 10 },
  rowMain:          { flex: 1 },
  rowLabel:         { fontSize: 13, fontWeight: '400', color: colors.text, marginBottom: 1 },
  rowLabelSelected: { fontWeight: '600' },
  rowSub:           { fontSize: 11, fontWeight: '300', color: colors.textMuted },
  sep:              { height: 0.5, backgroundColor: colors.borderLight },
  check:            { fontSize: 14, fontWeight: '600', color: colors.blue },

  // Segmented control (Manual / Strava toggle)
  segmentedControl: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 8, backgroundColor: '#e1e0db', borderRadius: 8, padding: 2, gap: 2 },
  segment:          { flex: 1, padding: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive:    { backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  segmentText:      { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  segmentTextActive: { fontWeight: '600', color: colors.text },

  // Form fields (manual entry)
  formHeader:   { padding: 12 },
  formTitle:    { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 2 },
  formSubtitle: { fontSize: 11, fontWeight: '300', color: colors.textMuted },
  formRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  formLabel:    { width: 100, fontSize: 12, fontWeight: '400', color: colors.textMid },
  formInput:    { flex: 1, backgroundColor: colors.bg, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, fontWeight: '400', color: colors.text, borderWidth: 0.5, borderColor: colors.borderLight },

  // Duration inputs
  durationInputs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  durationField:  { flex: 1, minWidth: 44, textAlign: 'center' },
  durationLabel:  { fontSize: 11, fontWeight: '300', color: colors.textMuted },

  // Strava card
  stravaHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  stravaLogo:   { width: 32, height: 32, borderRadius: 7, backgroundColor: '#FC4C0220', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stravaLogoText: { fontSize: 15, fontWeight: '700', color: '#fc4c02' },
  stravaAction: { padding: 12, alignItems: 'center' },
  stravaActionText: { fontSize: 13, fontWeight: '500', color: '#fc4c02' },
  stravaActions:    { flexDirection: 'row', justifyContent: 'space-between' },
  stravaDisconnect: { padding: 12, alignItems: 'center' },
  stravaDisconnectText: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  stravaErrorRow:  { paddingHorizontal: 12, paddingBottom: 8 },
  stravaErrorText: { fontSize: 10, fontWeight: '300', color: colors.warn },

  statusDotConnected:    { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good },
  statusDotDisconnected: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },

  // Stats grid
  statsGrid:       { flexDirection: 'row' },
  statCell:        { flex: 1, padding: 10, alignItems: 'center' },
  statCellBorder:  { borderLeftWidth: 0.5, borderLeftColor: colors.borderLight },
  statLabel:       { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  statValue:       { fontSize: 14, fontWeight: '500', color: colors.text },

  // Constraint summary
  constraintRow:   { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  constraintLabel: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  constraintValue: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.text },
});
