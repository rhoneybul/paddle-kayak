import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme';
import { SheetHandle, MetricStrip, ConditionLayer, SectionHeader, AlertBanner, PrimaryButton } from '../components/UI';
import { getWeatherWithCache } from '../services/weatherService';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';

const WindIcon  = () => <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Path d="M2 6 Q7 6,11 6 Q14.5 5,14.5 3.5 Q14.5 2,12.5 2 Q10.5 2,10.5 4" stroke={colors.textMuted} strokeWidth={1} fill="none" strokeLinecap="round"/><Path d="M2 9.5 Q9 9.5,13 9.5 Q16.5 9,16.5 7.5 Q16.5 6,14.5 6 Q12.5 6,12.5 8" stroke={colors.textMuted} strokeWidth={1} fill="none" strokeLinecap="round"/><Path d="M2 13 Q7 13,9.5 13 Q12 13,12 15 Q12 16.5,10.5 16.5" stroke={colors.textMuted} strokeWidth={1} fill="none" strokeLinecap="round"/></Svg>;
const SwellIcon = () => <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Path d="M1 11 Q3.5 8,6 11 Q8.5 14,11 11 Q13.5 8,16 11" stroke={colors.textMuted} strokeWidth={1} fill="none" strokeLinecap="round"/><Path d="M1 15 Q3.5 12.5,6 15 Q8.5 17.5,11 15" stroke={colors.textMuted} strokeWidth={0.7} fill="none" strokeLinecap="round" opacity={0.45}/></Svg>;
const RainIcon  = () => <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Path d="M4.5 8.5 Q6 4,10.5 5.5 Q14 3,13.5 7 Q16.5 6,16.5 9.5 Q16.5 13,13.5 13H5 Q2 13,4.5 9.5Z" stroke={colors.textMuted} strokeWidth={1} fill="none"/><Path d="M6 15v1.5M9.5 14.5v2M13 15v1.5" stroke={colors.textMuted} strokeWidth={0.9} strokeLinecap="round" opacity={0.5}/></Svg>;
const TideIcon  = () => <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Path d="M2 14.5 Q4.5 12,7 14.5 Q9.5 17,12 14.5 Q14.5 12,17 14.5" stroke={colors.textMuted} strokeWidth={1} fill="none" strokeLinecap="round"/><Path d="M9.5 4 L9.5 11 M7 6.5 L9.5 4 L12 6.5" stroke={colors.textMuted} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round"/></Svg>;
const TempIcon  = () => <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Rect x={7.5} y={2} width={3} height={9} rx={1.5} stroke={colors.textMuted} strokeWidth={1} fill="none"/><Circle cx={9} cy={14.5} r={2.8} stroke={colors.textMuted} strokeWidth={1} fill="none"/><Path d="M13 5.5h1.5M13 7.5h1M13 9.5h1.5" stroke={colors.textMuted} strokeWidth={0.8} strokeLinecap="round"/></Svg>;

const DEMO_LOC = { lat: 51.505, lon: -0.09 };

export default function WeatherScreen({ navigation, route }) {
  const params = route?.params || {};
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let coords = DEMO_LOC;
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { lat: loc.coords.latitude, lon: loc.coords.longitude };
      }
      const w = await getWeatherWithCache(coords.lat, coords.lon);
      setWeather(w);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch { setError('Could not load weather. Check connection.'); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <View style={[s.container, s.center]}>
      <ActivityIndicator color={colors.good} />
      <Text style={s.loadText}>Loading conditions…</Text>
    </View>
  );

  if (error) return (
    <View style={[s.container, s.center]}>
      <Text style={s.errText}>{error}</Text>
      <TouchableOpacity style={s.retryBtn} onPress={load}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
    </View>
  );

  const w = weather;
  const sc = w.safetyScore;
  const scoreColor = sc >= 70 ? colors.good : sc >= 50 ? colors.caution : colors.warn;
  const windOk  = w.current.windSpeed <= 18;
  const swellOk = (w.current.waveHeight || 0) <= 0.8;

  return (
    <View style={s.container}>
      <SafeAreaView style={s.safe}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}><Text style={s.backText}>‹</Text></TouchableOpacity>
          <Text style={s.navTitle}>Conditions</Text>
          {w.fromCache && <Text style={s.cached}>Cached</Text>}
        </View>

        <Animated.ScrollView style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>

          {/* Score hero */}
          <View style={s.scoreCard}>
            <View>
              <Text style={[s.scoreNum, { color: scoreColor }]}>{sc}</Text>
              <Text style={s.scoreLabel}>Paddling score</Text>
            </View>
            <View style={s.scoreRight}>
              <View style={[s.scoreBadge, { backgroundColor: scoreColor + '18' }]}>
                <Text style={[s.scoreBadgeText, { color: scoreColor }]}>{w.safetyLabel}</Text>
              </View>
              <Text style={s.scoreCondition}>{w.current.condition.label}</Text>
              <Text style={s.scoreTemp}>{w.current.temp}°C · feels {w.current.temp - 2}°</Text>
            </View>
          </View>

          {/* Layered conditions */}
          <SectionHeader>Conditions</SectionHeader>
          <View style={s.condCard}>
            <ConditionLayer icon={<WindIcon/>} name="Wind" desc={`${w.current.windDirLabel} · Gusts to ${Math.round(w.current.windSpeed * 1.2)} kts`} value={`${w.current.windSpeed}`} unit="knots" fillPct={(w.current.windSpeed / 30) * 100} barColor={windOk ? colors.good : colors.caution} bg={colors.white} />
            <ConditionLayer icon={<SwellIcon/>} name="Swell" desc="Period 8s · SSW direction" value={`${(w.current.waveHeight || 0.4).toFixed(1)}`} unit="metres" fillPct={((w.current.waveHeight || 0.4) / 3) * 100} barColor={swellOk ? colors.good : colors.caution} bg="#fafaf7" />
            <ConditionLayer icon={<RainIcon/>} name="Rain" desc={`${w.current.precipitation}mm today · ${w.hourly[0]?.precipProb || 5}% chance`} value={`${w.hourly[0]?.precipProb || 5}`} unit="%" fillPct={w.hourly[0]?.precipProb || 5} barColor={colors.blue} bg={colors.white} />
            <ConditionLayer icon={<TideIcon/>} name="Tide" desc="Incoming · High 11:24 AM (1.4m)" value="0.9" unit="metres" fillPct={64} barColor={colors.blue} bg="#fafaf7" />
            <ConditionLayer icon={<TempIcon/>} name="Water temp" desc="Wetsuit recommended below 18°" value="16" unit="°C" fillPct={53} barColor="#8a7a6a" bg={colors.white} />
          </View>

          {/* Best window */}
          <View style={s.windowRow}>
            <Text style={s.windowText}>Best paddling window</Text>
            <Text style={[s.windowTime, { color: w.weatherWindow?.color || colors.good }]}>{w.weatherWindow?.label || '8–11 AM'}</Text>
          </View>

          {/* Hourly */}
          <SectionHeader>Hourly wind</SectionHeader>
          <View style={s.hourlyCard}>
            <Text style={s.hourlyTitle}>Today</Text>
            <View style={s.hourlyRow}>
              {(w.hourly || []).slice(0, 5).map((h, i) => {
                const t = new Date(h.time);
                const timeStr = `${t.getHours()}:00`;
                const wc = h.windSpeed > 18 ? colors.caution : colors.good;
                return (
                  <View key={i} style={[s.hourCell, i < 4 && s.hourCellBorder]}>
                    <Text style={s.hourTime}>{timeStr}</Text>
                    <Text style={s.hourIcon}>{h.condition.icon}</Text>
                    <Text style={[s.hourWind, { color: wc }]}>{h.windSpeed}</Text>
                    <Text style={s.hourSub}>kts</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* 3-day */}
          <SectionHeader>3-Day forecast</SectionHeader>
          <View style={s.dayCard}>
            {(w.daily || []).slice(0, 3).map((d, i) => {
              const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(d.date).toLocaleDateString('en', { weekday: 'short' });
              return (
                <View key={i} style={[s.dayRow, i < 2 && s.dayRowBorder]}>
                  <Text style={[s.dayName, i > 0 && { color: colors.textMuted }]}>{label}</Text>
                  <Text style={s.dayIcon}>{d.condition.icon}</Text>
                  <Text style={s.dayCondition}>{d.condition.label}</Text>
                  <Text style={s.dayWind}>{d.windMax} kts</Text>
                  <Text style={s.dayTemp}>{d.tempMax}° / {d.tempMin}°</Text>
                </View>
              );
            })}
          </View>

          <View style={s.ctaWrap}>
            <PrimaryButton label="View Route Options →" onPress={() => navigation.navigate('Routes', { weather: w, ...params })} />
            <TouchableOpacity onPress={load} style={s.refreshBtn}>
              <Text style={s.refreshText}>Refresh weather</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 32 }} />
        </Animated.ScrollView>
      </SafeAreaView>
    </View>
  );
}

const P = 16;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadText: { fontSize: 13, fontWeight: '300', color: colors.textMuted },
  errText: { fontSize: 13, color: colors.warn, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { backgroundColor: colors.text, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { fontSize: 13, fontWeight: '500', color: colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.good },
  navTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 4 },
  cached: { fontSize: 10.5, fontWeight: '300', color: colors.textMuted },
  scoreCard: { marginHorizontal: P, marginTop: 12, marginBottom: 12, backgroundColor: colors.white, borderRadius: 9, padding: 16, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  scoreNum: { fontSize: 48, fontWeight: '300', lineHeight: 50 },
  scoreLabel: { fontSize: 9, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  scoreRight: { alignItems: 'flex-end', paddingTop: 4, gap: 6 },
  scoreBadge: { borderRadius: 5, paddingHorizontal: 9, paddingVertical: 3 },
  scoreBadgeText: { fontSize: 11, fontWeight: '500' },
  scoreCondition: { fontSize: 12, fontWeight: '300', color: colors.textMid },
  scoreTemp: { fontSize: 11, fontWeight: '300', color: colors.textMuted },
  condCard: { marginHorizontal: P, marginTop: 0, marginBottom: 12, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  windowRow: { marginHorizontal: P, marginBottom: 12, backgroundColor: colors.white, borderRadius: 9, padding: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.borderLight },
  windowText: { fontSize: 12, fontWeight: '400', color: colors.textMid },
  windowTime: { fontSize: 12, fontWeight: '500' },
  hourlyCard: { marginHorizontal: P, marginBottom: 12, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  hourlyTitle: { paddingHorizontal: P, paddingVertical: 8, fontSize: 11, fontWeight: '500', color: colors.text, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  hourlyRow: { flexDirection: 'row' },
  hourCell: { flex: 1, paddingVertical: 8, alignItems: 'center', gap: 2 },
  hourCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  hourTime: { fontSize: 9, fontWeight: '300', color: colors.textMuted },
  hourIcon: { fontSize: 14 },
  hourWind: { fontSize: 13, fontWeight: '500' },
  hourSub: { fontSize: 8, fontWeight: '300', color: colors.textMuted },
  dayCard: { marginHorizontal: P, marginBottom: 12, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  dayRow: { flexDirection: 'row', alignItems: 'center', padding: 11, paddingVertical: 9 },
  dayRowBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  dayName: { fontSize: 13, fontWeight: '600', color: colors.text, width: 68 },
  dayIcon: { fontSize: 16, marginRight: 8 },
  dayCondition: { flex: 1, fontSize: 12, fontWeight: '300', color: colors.textMid },
  dayWind: { fontSize: 12, fontWeight: '300', color: colors.textMuted, marginRight: 8 },
  dayTemp: { fontSize: 12, fontWeight: '500', color: colors.text },
  ctaWrap: { marginTop: 4 },
  refreshBtn: { alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  refreshText: { fontSize: 12, fontWeight: '300', color: colors.textMuted },
});
