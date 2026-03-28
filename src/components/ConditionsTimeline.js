/**
 * ConditionsTimeline — fixed row labels on the left, horizontally scrollable
 * time columns on the right.  Each column shows one hour.
 *
 * Rows: Wind (kt + direction arrow + head/tail/cross) · Temp · Rain · Swell · Tide (line chart)
 *
 * Props:
 *   hourly         array       from weatherData.hourly
 *   date           string      YYYY-MM-DD — filter to this day
 *   startHour      number      only show hours >= startHour (optional)
 *   endHour        number      only show hours <= endHour (optional)
 *   routeBearing   number|null from gpxRouteBearing()
 *   tideHeightMap  object      { "YYYY-MM-DDTHH:00": metres }
 *   tideExtremeMap object      { "YYYY-MM-DDTHH:00": { height, type } }
 */
import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

const COL_W    = 54;
const BAR_MAX  = 40;
const LABEL_W  = 52;
const TIDE_H   = 64;   // height of the tide line chart row

const ROW_HEIGHTS = {
  wind:  96,
  temp:  56,
  rain:  52,
  swell: 72,
  time:  20,
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

// ── Row label ─────────────────────────────────────────────────────────────────

function RowLabel({ label, height, sub }) {
  return (
    <View style={[s.rowLabelCell, { height }]}>
      <Text style={s.rowLabelText}>{label}</Text>
      {sub ? <Text style={s.rowLabelSub}>{sub}</Text> : null}
    </View>
  );
}

// ── Single time column ─────────────────────────────────────────────────────────

function TimeColumn({ h, routeBearing, minTemp, maxTemp, hasMarine, colWidth = COL_W }) {
  const barW = Math.max(18, Math.floor(colWidth * 0.5));
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
    <View style={[s.col, { width: colWidth }]}>

      {/* Wind row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.wind }]}>
        {h.windDir != null
          ? <View style={[s.arrowWrap, arrowStyle(h.windDir)]}><Text style={[s.arrow, { color: wCol }]}>↑</Text></View>
          : <View style={s.arrowWrap} />}
        <View style={s.barWrap}>
          <View style={[s.bar, { height: wBarH, width: barW, backgroundColor: wCol }]} />
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
          <View style={[s.bar, { height: tBarH, width: barW, backgroundColor: tCol + 'cc' }]} />
        </View>
        <Text style={[s.val, { color: colors.textMid }]}>{temp}°</Text>
      </View>

      {/* Rain row */}
      <View style={[s.cell, { height: ROW_HEIGHTS.rain }]}>
        <View style={s.barWrap}>
          <View style={[s.bar, { height: rBarH, width: barW, backgroundColor: rCol }]} />
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
            <View style={[s.bar, { height: wBarH2, width: barW, backgroundColor: wCol2 }]} />
          </View>
          <Text style={[s.val, { color: wCol2 }]}>{wh != null ? wh.toFixed(1) : '—'}m</Text>
          {h.wavePeriod != null
            ? <Text style={s.sub}>{Math.round(h.wavePeriod)}s</Text>
            : null}
        </View>
      )}

      {/* Time label */}
      <View style={[s.cell, { height: ROW_HEIGHTS.time }]}>
        <Text style={s.timeLabel}>{formatHour(h.time)}</Text>
      </View>

    </View>
  );
}

// ── Tide line chart ───────────────────────────────────────────────────────────

function TideLineChart({ display, tideHeightMap, tideExtremeMap, colWidth }) {
  const PAD_V = 14; // vertical padding for labels
  const chartH = TIDE_H;
  const totalW = display.length * colWidth;

  const heights = display.map(h => {
    const key = h.time?.slice(0, 13) + ':00';
    return tideHeightMap[key] ?? null;
  });

  const valid = heights.filter(h => h !== null);
  if (valid.length < 2) return null;

  const minH  = Math.min(...valid);
  const maxH  = Math.max(...valid);
  const range = Math.max(maxH - minH, 0.01);

  const toY = h => PAD_V + ((maxH - h) / range) * (chartH - PAD_V * 2);
  const toX = i => (i + 0.5) * colWidth;

  // Build smooth cubic bezier path
  const pts = heights
    .map((h, i) => h !== null ? { x: toX(i), y: toY(h) } : null)
    .filter(Boolean);

  let linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpX  = (prev.x + curr.x) / 2;
    linePath += ` C ${cpX.toFixed(1)} ${prev.y.toFixed(1)}, ${cpX.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }

  const areaPath =
    linePath +
    ` L ${pts[pts.length - 1].x.toFixed(1)} ${chartH}` +
    ` L ${pts[0].x.toFixed(1)} ${chartH} Z`;

  return (
    <View style={{ width: totalW, height: chartH, borderTopWidth: 0.5, borderTopColor: colors.borderLight }}>
      <Svg width={totalW} height={chartH}>
        <Defs>
          <LinearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity="0.18" />
            <Stop offset="1" stopColor={colors.primary} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {/* Filled area */}
        <Path d={areaPath} fill="url(#tideGrad)" />

        {/* Line */}
        <Path d={linePath} stroke={colors.primary} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Extreme markers */}
        {display.map((h, i) => {
          const key     = h.time?.slice(0, 13) + ':00';
          const extreme = tideExtremeMap[key];
          const ht      = heights[i];
          if (!extreme || ht == null) return null;
          const x   = toX(i);
          const y   = toY(ht);
          const isH = extreme.type === 'High';
          const col = isH ? colors.primary : colors.textMuted;
          return (
            <Svg key={i} overflow="visible">
              <Circle cx={x} cy={y} r={3} fill={col} stroke="#fff" strokeWidth={1} />
              <SvgText
                x={x} y={isH ? y - 5 : y + 12}
                textAnchor="middle"
                fontSize={7} fontWeight="600"
                fill={col}
              >
                {ht.toFixed(1)}m
              </SvgText>
            </Svg>
          );
        })}
      </Svg>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConditionsTimeline({ hourly = [], date, startHour, endHour, routeBearing, tideHeightMap = {}, tideExtremeMap = {} }) {
  const [scrollW, setScrollW] = useState(0);
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
  const temps  = display.map(h => h.temp ?? 0);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps, minTemp + 1);
  const hasTides = Object.keys(tideHeightMap).length > 0;

  const colWidth = scrollW > 0
    ? Math.max(COL_W, Math.floor((scrollW - (display.length - 1) * 2) / display.length))
    : COL_W;

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
          {hasTides  && <RowLabel label="Tide"  height={TIDE_H} sub="m" />}
          <View style={{ height: ROW_HEIGHTS.time }} />
        </View>

        {/* Scrollable content — columns + tide chart stacked in same scroll container */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.scrollArea}
          contentContainerStyle={{ flexDirection: 'column' }}
          onLayout={e => setScrollW(e.nativeEvent.layout.width)}
        >
          {/* Hour columns */}
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {display.map((h, i) => (
              <TimeColumn
                key={i}
                h={h}
                routeBearing={routeBearing}
                minTemp={minTemp}
                maxTemp={maxTemp}
                hasMarine={hasMarine}
                colWidth={colWidth}
              />
            ))}
          </View>

          {/* Tide line chart — spans full width, scrolls with columns */}
          {hasTides && (
            <TideLineChart
              display={display}
              tideHeightMap={tideHeightMap}
              tideExtremeMap={tideExtremeMap}
              colWidth={colWidth}
            />
          )}
        </ScrollView>

      </View>

      {/* No-data note */}
      {!hasTides && (
        <View style={s.tideNote}>
          <Text style={s.tideNoteText}>Tide data unavailable — add EXPO_PUBLIC_WORLDTIDES_API_KEY</Text>
        </View>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight, padding: 20, paddingBottom: 16 },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title:   { fontSize: 10, fontWeight: '600', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  bearingNote: { fontSize: 9, fontWeight: '300', color: colors.textMuted },

  grid:        { flexDirection: 'row' },
  labelsCol:   { },
  scrollArea:  { flex: 1 },

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
