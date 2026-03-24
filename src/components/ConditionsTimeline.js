/**
 * ConditionsTimeline — fixed row labels on the left, horizontally scrollable
 * time columns on the right.  Each column shows one hour.
 *
 * Rows: Wind (kt + direction arrow + head/tail/cross) · Temp · Rain · Swell · Tide
 *
 * Props:
 *   hourly       array       from weatherData.hourly
 *   date         string      YYYY-MM-DD — filter to this day
 *   startHour    number      only show hours >= startHour (optional)
 *   endHour      number      only show hours <= endHour (optional)
 *   routeBearing number|null from gpxRouteBearing()
 */
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme';

const COL_W    = 52;
const BAR_MAX  = 40;   // px height of tallest bar
const LABEL_W  = 52;   // width of the fixed left-label column
const ROW_HEIGHTS = {
  wind:  96,   // arrow + bar + kt + cardinal + head/tail badge
  temp:  56,   // bar + °C
  rain:  52,   // bar + %
  swell: 72,   // arrow + bar + m + period
  tide:  28,   // placeholder text
  time:  20,   // hour label at bottom
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function arrowStyle(fromDeg) {
  return { transform: [{ rotate: `${((fromDeg ?? 0) + 180) % 360}deg` }] };
}

function relWind(windFrom, bearing) {
  if (windFrom == null || bearing == null) return null;
  const to = (windFrom + 180) % 360;
  let d = ((to - bearing) + 360) % 360;
  if (d > 180) d = 360 - d;
  if (d <= 30)  return 'tail';
  if (d >= 150) return 'head';
  return ((to - bearing + 360) % 360) < 180 ? 'stbd' : 'port';
}

function relColor(r) {
  if (r === 'head') return colors.warn;
  if (r === 'tail') return colors.primary;
  if (r)            return colors.caution;
  return colors.textMuted;
}

function windBarColor(spd) {
  return spd > 20 ? colors.warn : spd > 12 ? colors.caution : colors.primary;
}

function formatHour(timeStr) {
  const h = new Date(timeStr).getHours();
  return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
}

// ── Row label component ───────────────────────────────────────────────────────

function RowLabel({ label, height, sub }) {
  return (
    <View style={[s.rowLabelCell, { height }]}>
      <Text style={s.rowLabelText}>{label}</Text>
      {sub ? <Text style={s.rowLabelSub}>{sub}</Text> : null}
    </View>
  );
}

// ── Single time column ────────────────────────────────────────────────────────

function TimeColumn({ h, routeBearing, minTemp, maxTemp, hasMarine }) {
  const spd   = h.windSpeed ?? 0;
  const rel   = relWind(h.windDir, routeBearing);
  const wCol  = windBarColor(spd);
  const wBarH = Math.max(4, Math.round(Math.min(spd / 30, 1) * BAR_MAX));

  const temp   = h.temp ?? 0;
  const tRange = Math.max(maxTemp - minTemp, 1);
  const tBarH  = Math.max(4, Math.round(((temp - minTemp) / tRange) * (BAR_MAX - 8) + 8));
  const tCol   = temp <= 5 ? '#6b9fd4' : temp <= 15 ? colors.primary : temp <= 22 ? colors.caution : colors.warn;

  const pp    = h.precipProb ?? 0;
  const rBarH = Math.max(2, Math.round((pp / 100) * BAR_MAX));
  const rCol  = pp > 70 ? colors.warn : pp > 40 ? colors.caution : colors.borderLight;

  const wh    = h.swellHeight ?? h.waveHeight ?? null;
  const wBarH2 = wh != null ? Math.max(2, Math.round(Math.min(wh / 3, 1) * BAR_MAX)) : 0;
  const wCol2  = wh != null ? (wh > 1.5 ? colors.warn : wh > 0.5 ? colors.caution : colors.primary) : colors.borderLight;
  const wDir   = h.swellDir ?? h.waveDir;

  return (
    <View style={[s.col, { width: COL_W }]}>

      {/* Wind row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.wind }]}>
        {h.windDir != null
          ? <View style={[s.arrowWrap, arrowStyle(h.windDir)]}><Text style={[s.arrow, { color: wCol }]}>↑</Text></View>
          : <View style={s.arrowWrap} />}
        <View style={s.barWrap}>
          <View style={[s.bar, { height: wBarH, backgroundColor: wCol }]} />
        </View>
        <Text style={[s.val, { color: wCol }]}>{Math.round(spd)}kt</Text>
        <Text style={s.sub}>{h.windDirLabel || '—'}</Text>
        {rel
          ? <View style={[s.badge, { backgroundColor: relColor(rel) + '25' }]}>
              <Text style={[s.badgeText, { color: relColor(rel) }]}>{rel}</Text>
            </View>
          : <View style={s.badgePlaceholder} />}
      </View>

      {/* Temp row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.temp }]}>
        <View style={s.barWrap}>
          <View style={[s.bar, { height: tBarH, backgroundColor: tCol + 'cc' }]} />
        </View>
        <Text style={[s.val, { color: colors.textMid }]}>{temp}°</Text>
      </View>

      {/* Rain row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.rain }]}>
        <View style={s.barWrap}>
          <View style={[s.bar, { height: rBarH, backgroundColor: rCol }]} />
        </View>
        <Text style={[s.val, { color: colors.textMuted }]}>{pp}%</Text>
      </View>

      {/* Swell row */}
      {hasMarine && (
        <View style={[s.cell, { height: ROW_HEIGHTS.swell }]}>
          {wDir != null
            ? <View style={[s.arrowWrap, arrowStyle(wDir)]}><Text style={[s.arrow, { color: wCol2 }]}>↑</Text></View>
            : <View style={s.arrowWrap} />}
          <View style={s.barWrap}>
            <View style={[s.bar, { height: wBarH2, backgroundColor: wCol2 }]} />
          </View>
          <Text style={[s.val, { color: wCol2 }]}>{wh != null ? wh.toFixed(1) : '—'}m</Text>
          {h.wavePeriod != null
            ? <Text style={s.sub}>{Math.round(h.wavePeriod)}s</Text>
            : null}
        </View>
      )}

      {/* Tide row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.tide }]} />

      {/* Time label */}
      <View style={[s.cell, { height: ROW_HEIGHTS.time }]}>
        <Text style={s.timeLabel}>{formatHour(h.time)}</Text>
      </View>

    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConditionsTimeline({ hourly = [], date, startHour, endHour, routeBearing }) {
  const slots = hourly.filter(h => {
    if (!h.time) return false;
    if (date) { if (h.time.slice(0, 10) !== date) return false; }
    const hr = new Date(h.time).getHours();
    if (startHour != null && hr < startHour) return false;
    if (endHour   != null && hr > endHour)   return false;
    return true;
  });

  const display = slots.length > 0 ? slots : hourly.slice(0, 24);
  if (display.length === 0) return null;

  const hasMarine = display.some(h => h.waveHeight != null || h.swellHeight != null);
  const temps = display.map(h => h.temp ?? 0);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps, minTemp + 1);

  return (
    <View style={s.wrap}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Conditions through the day</Text>
        {routeBearing != null && (
          <Text style={s.bearingNote}>Heading {Math.round(routeBearing)}°</Text>
        )}
      </View>

      <View style={s.grid}>

        {/* Fixed left labels */}
        <View style={[s.labelsCol, { width: LABEL_W }]}>
          <RowLabel label="Wind"  height={ROW_HEIGHTS.wind}  sub="kt" />
          <RowLabel label="Temp"  height={ROW_HEIGHTS.temp}  sub="°C" />
          <RowLabel label="Rain"  height={ROW_HEIGHTS.rain}  sub="%" />
          {hasMarine && <RowLabel label="Swell" height={ROW_HEIGHTS.swell} sub="m" />}
          <RowLabel label="Tide"  height={ROW_HEIGHTS.tide} />
          <View style={{ height: ROW_HEIGHTS.time }} />
        </View>

        {/* Scrollable data columns */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.scrollArea}
          contentContainerStyle={s.scrollContent}
        >
          {display.map((h, i) => (
            <TimeColumn
              key={i}
              h={h}
              routeBearing={routeBearing}
              minTemp={minTemp}
              maxTemp={maxTemp}
              hasMarine={hasMarine}
            />
          ))}
        </ScrollView>

      </View>

      {/* Tide note */}
      <View style={s.tideNote}>
        <Text style={s.tideNoteText}>Tide: set EXPO_PUBLIC_WORLDTIDES_API_KEY to enable</Text>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight, padding: 12, paddingBottom: 8 },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title:   { fontSize: 10, fontWeight: '600', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  bearingNote: { fontSize: 9, fontWeight: '300', color: colors.textMuted },

  grid:        { flexDirection: 'row' },
  labelsCol:   { },
  scrollArea:  { flex: 1 },
  scrollContent: { flexDirection: 'row', gap: 2 },

  rowLabelCell: { justifyContent: 'center', paddingRight: 6, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  rowLabelText: { fontSize: 9, fontWeight: '600', color: colors.textMid },
  rowLabelSub:  { fontSize: 7.5, fontWeight: '300', color: colors.textMuted },

  col:     { alignItems: 'center' },
  cell:    { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  arrowWrap: { marginBottom: 1 },
  arrow:   { fontSize: 12, lineHeight: 14 },
  barWrap: { height: BAR_MAX, justifyContent: 'flex-end', marginBottom: 2 },
  bar:     { width: 18, borderRadius: 2 },
  val:     { fontSize: 9, fontWeight: '600', lineHeight: 11 },
  sub:     { fontSize: 7.5, fontWeight: '300', color: colors.textMuted, lineHeight: 10 },
  badge:   { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, marginTop: 1 },
  badgeText: { fontSize: 7, fontWeight: '700' },
  badgePlaceholder: { height: 14 },
  timeLabel: { fontSize: 8, fontWeight: '400', color: colors.textMid, textAlign: 'center' },

  tideNote:     { marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  tideNoteText: { fontSize: 8, fontWeight: '300', color: colors.textFaint },
});
