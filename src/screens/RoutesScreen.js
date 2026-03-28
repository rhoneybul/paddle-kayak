import React, { useEffect, useState, useCallback } from 'react';
import { HomeIcon } from '../components/Icons';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import MapSketch from '../components/MapSketch';
import {
  SheetHandle, SectionHeader, AlertBanner, PrimaryButton, MetricStrip,
  ConditionLayer, ErrorState, HeartIcon, NavigateToStartButton,
} from '../components/UI';
import { generateRoutes } from '../services/routeService';
import { saveActiveTrip, saveRoute, getSavedRoutes, deleteSavedRoute } from '../services/storageService';
import { getWeatherWithCache as getWeather } from '../services/weatherService';
import { extractStartCoords, navigateToStart } from '../services/navigationService';

// SVG icons as simple text for condition layers
const WindIcon  = () => <Text style={{ fontSize: 14 }}>{'\uD83D\uDCA8'}</Text>;
const RainIcon  = () => <Text style={{ fontSize: 14 }}>{'\uD83C\uDF27\uFE0F'}</Text>;

export default function RoutesScreen({ navigation, route }) {
  const { tripType, skillLevel, weather: passedWeather, location } = route?.params || {};
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(0);
  const [routeWeather, setRouteWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  const [loadError, setLoadError] = useState(null);    // Ticket 4
  const [refreshing, setRefreshing] = useState(false);  // Ticket 5
  const [savedRouteNames, setSavedRouteNames] = useState(new Set()); // Ticket 3

  // Generate routes on mount
  useEffect(() => {
    const defaultWeather = passedWeather || {
      current: { windSpeed: 12, waveHeight: 0.4, condition: { label: 'Partly Cloudy', severity: 'none' }, windDirLabel: 'WSW', temp: 14, precipitation: 0, weatherCode: 1 },
      hourly: [], daily: [],
      safetyScore: 78, safetyLabel: 'Good', safetyColor: colors.good,
      weatherWindow: { label: 'Best: 8:00 AM', color: colors.good },
    };
    const r = generateRoutes({
      tripType, skillLevel, weather: defaultWeather, location,
      durationDays: tripType?.days || 1,
    });
    setRoutes(r);
  }, []);

  // Fetch weather for the selected route area
  const fetchWeather = useCallback(async () => {
    if (routeWeather) return; // already fetched
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const lat = location?.coords?.lat || 50.75;
      const lon = location?.coords?.lon || -3.0;
      const data = await getWeather(lat, lon);
      setRouteWeather(data);
    } catch (err) {
      setWeatherError(err.message || 'Could not fetch weather');
    } finally {
      setWeatherLoading(false);
    }
  }, [location, routeWeather]);

  useEffect(() => { fetchWeather(); }, [fetchWeather]);

  // Ticket 3: Load saved route names
  const loadSavedRouteNames = useCallback(async () => {
    try {
      const saved = await getSavedRoutes();
      setSavedRouteNames(new Set(saved.map(r => r.name)));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadSavedRouteNames(); }, [loadSavedRouteNames]);

  const isRouteFavorited = (routeName) => savedRouteNames.has(routeName);

  const handleToggleFavorite = async (routeData) => {
    const name = routeData.name || '';
    if (isRouteFavorited(name)) {
      Alert.alert('Remove Favorite', `Remove "${name}" from saved routes?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            const saved = await getSavedRoutes();
            const target = saved.find(r => r.name === name);
            if (target) await deleteSavedRoute(target.id);
            setSavedRouteNames(prev => { const next = new Set(prev); next.delete(name); return next; });
          } catch { /* ignore */ }
        }},
      ]);
    } else {
      try {
        await saveRoute(routeData, name);
        setSavedRouteNames(prev => new Set(prev).add(name));
      } catch { Alert.alert('Error', 'Could not save route.'); }
    }
  };

  // Ticket 1: Navigate to start
  const handleNavigateToStart = (r) => {
    const coords = extractStartCoords(r);
    if (!coords) { Alert.alert('No Coordinates', 'Start location is not available.'); return; }
    navigateToStart(coords.lat, coords.lng);
  };

  // Ticket 5: Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setRouteWeather(null);
      await fetchWeather();
      await loadSavedRouteNames();
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, [fetchWeather, loadSavedRouteNames]);

  const sel = routes[selected] || {};
  const isMultiDay = (tripType?.days || 1) > 1;

  // Weather data for display
  const wx = routeWeather || passedWeather;
  const safetyScore = wx?.safetyScore ?? null;
  const safetyLabel = wx?.safetyLabel ?? 'Unknown';
  const safetyColor = wx?.safetyColor ?? colors.textMuted;
  const windSpeed = wx?.current?.windSpeed ?? '-';
  const windDir   = wx?.current?.windDirLabel ?? '';
  const precip    = wx?.current?.precipitation ?? 0;
  const temp      = wx?.current?.temp ?? '-';

  const handleSelectRoute = async () => {
    const trip = {
      id: `trip_${Date.now()}`,
      tripType,
      skillLevel,
      weather: wx,
      location,
      route: sel,
      startedAt: Date.now(),
      status: 'active',
      log: [],
    };
    await saveActiveTrip(trip);
    navigation.navigate('ActivePaddle', { trip });
  };

  // Map paths for each route
  const routePaths = [
    { type: 'solid', d: 'M89 180 C89 143,71 114,97 85 C120 60,156 52,172 66 C187 80,181 108,168 127' },
    { type: 'dashed', d: 'M89 180 C101 155,126 143,140 151 C153 158,151 173,143 180', color: colors.mapRouteAlt },
    { type: 'faint', d: 'M89 180 C75 160,60 140,65 115 C70 90,85 75,105 65', color: colors.textMuted },
  ];

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>{'\u2039'}</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>Routes</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={s.homeBtn}>
            <HomeIcon size={22} color={colors.good} />
          </TouchableOpacity>
        </View>

        {/* Map with all routes */}
        <MapSketch
          height={222}
          routes={routePaths.slice(0, routes.length)}
          waypoints={[
            { x: 89, y: 180, type: 'start' },
            { x: 168, y: 127, type: 'end' },
            ...(routes.length > 2 ? [{ x: 105, y: 65, type: 'mid' }] : []),
            ...(isMultiDay ? [{ x: 132, y: 96, type: 'camp' }, { x: 152, y: 108, type: 'camp', faded: true }] : []),
          ]}
          windChip={windSpeed !== '-' ? { main: `${windSpeed} kts ${windDir}`, sub: `${temp}\u00b0C` } : null}
          showLegend={isMultiDay ? { campsites: 'Campsites' } : undefined}
        />

        <ScrollView
          style={s.sheet}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          <SheetHandle />

          {/* Safety score strip */}
          {safetyScore !== null && (
            <MetricStrip
              cells={[
                { label: 'Safety', value: `${safetyScore}`, color: safetyColor, sub: safetyLabel },
                { label: 'Wind', value: `${windSpeed}`, sub: `kts ${windDir}` },
                { label: 'Precip', value: `${precip}`, sub: 'mm' },
              ]}
            />
          )}

          {/* Weather condition layers */}
          {wx?.current && (
            <View style={s.conditionsCard}>
              <ConditionLayer
                icon={<WindIcon />}
                name="Wind"
                desc={`${windDir} ${windSpeed} kts`}
                value={windSpeed}
                unit="kts"
                fillPct={Math.min(100, (typeof windSpeed === 'number' ? windSpeed : 0) * 3)}
                barColor={typeof windSpeed === 'number' && windSpeed > 20 ? colors.warn : windSpeed > 12 ? colors.caution : colors.good}
              />
              <ConditionLayer
                icon={<RainIcon />}
                name="Precipitation"
                desc={precip > 0 ? `${precip} mm expected` : 'No rain expected'}
                value={precip}
                unit="mm"
                fillPct={Math.min(100, precip * 10)}
                barColor={precip > 2 ? colors.warn : precip > 0.5 ? colors.caution : colors.good}
              />
            </View>
          )}

          {weatherLoading && (
            <View style={s.weatherLoadingWrap}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={s.weatherLoadingText}>Fetching weather{'\u2026'}</Text>
            </View>
          )}

          {weatherError && (
            <AlertBanner
              type="caution"
              title="Weather unavailable"
              body={`${weatherError}. Tap retry to try again.`}
            />
          )}
          {weatherError && (
            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => { setRouteWeather(null); setWeatherError(null); fetchWeather(); }}
            >
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          )}

          {/* Route cards */}
          <SectionHeader>Choose your route</SectionHeader>
          {routes.map((r, i) => (
            <TouchableOpacity
              key={r.id}
              style={[s.routeCard, selected === i && s.routeCardSel]}
              onPress={() => setSelected(i)}
              activeOpacity={0.8}
            >
              <View style={s.routeHeader}>
                <View style={[s.rankBadge, { backgroundColor: i === 0 ? colors.goodLight : i === 1 ? colors.blueLight : colors.cautionLight }]}>
                  <Text style={[s.rankText, { color: i === 0 ? colors.good : i === 1 ? colors.blue : colors.caution }]}>{i + 1}</Text>
                </View>
                <Text style={s.routeName}>{r.name}</Text>
                <HeartIcon
                  filled={isRouteFavorited(r.name)}
                  size={18}
                  onPress={() => handleToggleFavorite(r)}
                />
                <View style={[s.diffBadge, { backgroundColor: r.difficulty.color + '20' }]}>
                  <Text style={[s.diffText, { color: r.difficulty.color }]}>{r.difficulty.label}</Text>
                </View>
              </View>

              {/* Route mini-map if selected */}
              {selected === i && (
                <View style={s.routeMapWrap}>
                  <MapSketch
                    height={120}
                    routes={[routePaths[i] || routePaths[0]]}
                    waypoints={[
                      { x: 89, y: 100, type: 'start' },
                      { x: 168, y: 80, type: 'end' },
                    ]}
                  />
                </View>
              )}

              <View style={s.routeStats}>
                {[
                  ['Distance', `${r.distanceKm} km`],
                  ['Time', `~${r.durationHours}h`],
                  ['Match', `${r.suitability}%`],
                  ['Difficulty', r.difficulty.label],
                ].map(([l, v]) => (
                  <View key={l} style={s.routeStat}>
                    <Text style={s.routeStatL}>{l}</Text>
                    <Text style={s.routeStatV}>{v}</Text>
                  </View>
                ))}
              </View>

              {selected === i && (
                <View style={s.routeDetail}>
                  <Text style={s.routeWhy}>{r.tips[0]}</Text>
                  {r.safetyBriefing?.length > 0 && (
                    <View style={s.safetyBriefing}>
                      {r.safetyBriefing.map((note, ni) => (
                        <Text key={ni} style={s.safetyNote}>{'\u26A0\uFE0F'} {note}</Text>
                      ))}
                    </View>
                  )}
                  {r.template?.terrain === 'sea' && r.tideConsideration?.advice && (
                    <Text style={s.routeTip}>{r.tideConsideration.advice}</Text>
                  )}
                  {r.weatherWindow && (
                    <View style={[s.weatherWindowChip, { borderColor: r.weatherWindow.color || colors.good }]}>
                      <Text style={[s.weatherWindowText, { color: r.weatherWindow.color || colors.good }]}>
                        {r.weatherWindow.label}
                      </Text>
                    </View>
                  )}
                  <NavigateToStartButton
                    onPress={() => handleNavigateToStart(r)}
                    disabled={!extractStartCoords(r)}
                    style={{ marginTop: 8 }}
                  />
                </View>
              )}
            </TouchableOpacity>
          ))}

          {isMultiDay && routes.length > 0 && (
            <>
              <SectionHeader>Campsites</SectionHeader>
              <TouchableOpacity style={s.campsiteLink} onPress={() => navigation.navigate('Campsites', { route: sel, location })}>
                <Text style={s.campsiteLinkText}>View campsites along this route {'\u2192'}</Text>
              </TouchableOpacity>
            </>
          )}

          <PrimaryButton label="Select Route & Start Paddle \u2192" onPress={handleSelectRoute} style={{ marginTop: 8 }} />
          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.good },
  navTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text, marginLeft: 4 },
  navRight: { fontSize: 10.5, fontWeight: '300', color: colors.textMuted },
  homeBtn:     { paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1 },
  // Conditions
  conditionsCard: { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  weatherLoadingWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  weatherLoadingText: { fontSize: 11, fontWeight: '300', color: colors.textMuted },
  retryBtn: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  retryText: { fontSize: 11, fontWeight: '500', color: colors.blue },
  // Route cards
  routeCard: { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  routeCardSel: { borderWidth: 1.5, borderColor: colors.text },
  routeHeader: { flexDirection: 'row', alignItems: 'center', padding: 11, gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  rankBadge: { width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText: { fontSize: 9, fontWeight: '600' },
  routeName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  diffBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  diffText: { fontSize: 9.5, fontWeight: '500' },
  routeMapWrap: { borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStats: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#f0ede8' },
  routeStat: { flex: 1, padding: 9, borderRightWidth: 0.5, borderRightColor: '#f0ede8' },
  routeStatL: { fontSize: 7.5, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  routeStatV: { fontSize: 14, fontWeight: '500', color: colors.text },
  routeDetail: { padding: 11 },
  routeWhy: { fontSize: 11.5, color: colors.textMid, lineHeight: 18, fontWeight: '300', marginBottom: 4 },
  routeTip: { fontSize: 10.5, color: colors.caution, fontWeight: '300', lineHeight: 16, marginTop: 4 },
  safetyBriefing: { marginTop: 4, marginBottom: 4 },
  safetyNote: { fontSize: 10, color: colors.warn, fontWeight: '300', lineHeight: 16, marginBottom: 2 },
  weatherWindowChip: { marginTop: 6, borderRadius: 5, borderWidth: 1, padding: 5, paddingHorizontal: 8, alignSelf: 'flex-start' },
  weatherWindowText: { fontSize: 10, fontWeight: '500' },
  campsiteLink: { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, padding: 12, borderWidth: 1, borderColor: colors.borderLight },
  campsiteLinkText: { fontSize: 13, fontWeight: '400', color: colors.blue },
});
