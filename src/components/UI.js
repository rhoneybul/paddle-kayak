import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, Platform } from 'react-native';
import { colors, layout, text, sheetHandle } from '../theme';

// ── Layout ────────────────────────────────────────────────────────────────────

export const SheetHandle = () => <View style={sheetHandle} />;

export const SectionHeader = ({ children, style }) => (
  <Text style={[s.sectionHeader, style]}>{children}</Text>
);

export const Card = ({ children, style, selected }) => (
  <View style={[s.card, selected && s.cardSelected, style]}>{children}</View>
);

// ── Table rows ────────────────────────────────────────────────────────────────

export const Row = ({ label, value, valueColor, right, style, onPress }) => {
  const content = (
    <View style={[s.row, style]}>
      <Text style={s.rowLabel}>{label}</Text>
      {value && <Text style={[s.rowValue, valueColor && { color: valueColor }]}>{value}</Text>}
      {right}
      <Text style={s.chevron}>›</Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>
  ) : content;
};

// ── Metric strip ─────────────────────────────────────────────────────────────

export const MetricStrip = ({ cells, style }) => (
  <View style={[s.metricStrip, style]}>
    {cells.map((c, i) => (
      <View key={i} style={[s.metricCell, i < cells.length - 1 && s.metricCellBorder]}>
        <Text style={s.metricLabel}>{c.label}</Text>
        <Text style={[s.metricValue, c.color && { color: c.color }]}>{c.value}</Text>
        {c.sub && <Text style={s.metricSub}>{c.sub}</Text>}
      </View>
    ))}
  </View>
);

// ── Layered condition row ─────────────────────────────────────────────────────

export const ConditionLayer = ({ icon, name, desc, value, unit, fillPct, barColor, bg }) => (
  <View style={[s.condLayer, bg && { backgroundColor: bg }]}>
    <View style={[s.condBar, { backgroundColor: barColor || colors.good }]} />
    <View style={s.condIcon}>{icon}</View>
    <View style={s.condMain}>
      <Text style={s.condName}>{name}</Text>
      <Text style={s.condDesc}>{desc}</Text>
      <View style={s.condMeter}>
        <View style={[s.condFill, { width: `${Math.min(100, fillPct || 0)}%`, backgroundColor: barColor || colors.good }]} />
      </View>
    </View>
    <View style={s.condRight}>
      <Text style={[s.condVal, { color: barColor || colors.good }]}>{value}</Text>
      <Text style={s.condUnit}>{unit}</Text>
    </View>
  </View>
);

// ── Buttons ───────────────────────────────────────────────────────────────────

export const PrimaryButton = ({ label, onPress, style }) => (
  <TouchableOpacity style={[s.primaryBtn, style]} onPress={onPress} activeOpacity={0.85}>
    <Text style={s.primaryBtnText}>{label}</Text>
  </TouchableOpacity>
);

export const GhostButton = ({ label, onPress, style }) => (
  <TouchableOpacity style={[s.ghostBtn, style]} onPress={onPress} activeOpacity={0.7}>
    <Text style={s.ghostBtnText}>{label}</Text>
  </TouchableOpacity>
);

export const SOSButton = ({ onPress }) => (
  <TouchableOpacity style={s.sosBtn} onPress={onPress} activeOpacity={0.85}>
    <View style={s.sosIcon}>
      <Text style={s.sosIconText}>!</Text>
    </View>
    <View>
      <Text style={s.sosBtnText}>SOS Emergency Alert</Text>
      <Text style={s.sosSubText}>Auto-triggers if no movement for 5 min</Text>
    </View>
  </TouchableOpacity>
);

export const StopButton = ({ label = 'Finish Paddle', onPress }) => (
  <TouchableOpacity style={s.stopBtn} onPress={onPress} activeOpacity={0.85}>
    <Text style={s.stopBtnText}>{label}</Text>
  </TouchableOpacity>
);

// ── Alert banners ─────────────────────────────────────────────────────────────

export const AlertBanner = ({ title, body, type = 'caution' }) => {
  const bg = type === 'warn' ? colors.warnLight : colors.cautionLight;
  const bd = type === 'warn' ? colors.warnBorder : colors.cautionBorder;
  const tc = type === 'warn' ? '#6a3a2a' : '#6a5a2a';
  return (
    <View style={[s.alert, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[s.alertTitle, { color: type === 'warn' ? colors.warn : colors.caution }]}>{title}</Text>
      <Text style={[s.alertBody, { color: tc }]}>{body}</Text>
    </View>
  );
};

// ── Progress bar ──────────────────────────────────────────────────────────────

export const ProgressBar = ({ startLabel, endLabel, pct, color }) => (
  <View style={s.progressWrap}>
    <View style={s.progressLabels}>
      <Text style={s.progressLabel}>{startLabel}</Text>
      <Text style={[s.progressPct, { color: color || colors.blue }]}>{Math.round(pct)}% complete</Text>
      <Text style={s.progressLabel}>{endLabel}</Text>
    </View>
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${Math.min(100, pct)}%`, backgroundColor: color || colors.blue }]} />
    </View>
  </View>
);

// ── Auth buttons ──────────────────────────────────────────────────────────────

export const AuthButton = ({ label, dark, logoComponent, onPress }) => (
  <TouchableOpacity
    style={[s.authBtn, dark ? s.authBtnDark : s.authBtnLight]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    {logoComponent && <View style={s.authLogo}>{logoComponent}</View>}
    <Text style={[s.authBtnText, dark ? s.authBtnTextDark : s.authBtnTextLight]}>{label}</Text>
  </TouchableOpacity>
);

// ── Toggle ────────────────────────────────────────────────────────────────────

export const Toggle = ({ value }) => (
  <View style={[s.toggle, value ? s.toggleOn : s.toggleOff]}>
    <View style={[s.toggleThumb, value ? s.toggleThumbOn : s.toggleThumbOff]} />
  </View>
);

// ── Campsite card ─────────────────────────────────────────────────────────────

export const CampsiteCard = ({ name, nearRoute, distKm, type, beach, water, source, selected }) => (
  <View style={[s.campsiteCard, selected && s.campsiteCardSelected]}>
    <View style={s.campsiteHeader}>
      <View style={s.campsiteIcon}>
        <Text style={s.campsiteIconText}>⛺</Text>
      </View>
      <Text style={s.campsiteName}>{name}</Text>
      <Text style={s.campsiteDist}>{distKm} km</Text>
    </View>
    <View style={s.campsiteStats}>
      {[
        ['Source', source || 'RIDB'],
        ['Beach', beach ? 'Yes' : 'No'],
        ['Water', water ? 'Yes' : 'No'],
        ['Type', type],
      ].map(([l, v]) => (
        <View key={l} style={s.campStat}>
          <Text style={s.campStatL}>{l}</Text>
          <Text style={[s.campStatV, (l === 'Beach' || l === 'Water') && { color: v === 'Yes' ? colors.good : colors.warn }]}>{v}</Text>
        </View>
      ))}
    </View>
  </View>
);

// ── Tab bar ───────────────────────────────────────────────────────────────────

export const TabBar = ({ tabs, active, onChange }) => (
  <View style={s.tabBar}>
    {tabs.map(t => (
      <TouchableOpacity key={t.key} style={[s.tab, active === t.key && s.tabActive]} onPress={() => onChange(t.key)}>
        <Text style={[s.tabText, active === t.key && s.tabTextActive]}>{t.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ── Slider ───────────────────────────────────────────────────────────────────

export const Slider = ({ min = 0, max = 100, step = 1, value, onValueChange, label, unit, style }) => {
  const trackRef = useRef(null);
  const trackWidth = useRef(0);

  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));

  const fraction = max > min ? (value - min) / (max - min) : 0;

  const updateValue = (pageX) => {
    if (!trackRef.current) return;
    trackRef.current.measure((_x, _y, width, _h, px) => {
      const ratio = Math.max(0, Math.min(1, (pageX - px) / width));
      const raw = min + ratio * (max - min);
      const stepped = clamp(raw);
      if (stepped !== value) onValueChange(stepped);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => updateValue(e.nativeEvent.pageX),
      onPanResponderMove: (e) => updateValue(e.nativeEvent.pageX),
    })
  ).current;

  return (
    <View style={[s.sliderWrap, style]}>
      {label && (
        <View style={s.sliderLabelRow}>
          <Text style={s.sliderLabel}>{label}</Text>
          <Text style={s.sliderValueLabel}>{value}{unit ? ` ${unit}` : ''}</Text>
        </View>
      )}
      <View
        ref={trackRef}
        style={s.sliderTrack}
        onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        <View style={[s.sliderFill, { width: `${fraction * 100}%` }]} />
        <View style={[s.sliderThumb, { left: `${fraction * 100}%` }]} />
      </View>
      <View style={s.sliderMinMax}>
        <Text style={s.sliderBound}>{min}{unit ? ` ${unit}` : ''}</Text>
        <Text style={s.sliderBound}>{max}{unit ? ` ${unit}` : ''}</Text>
      </View>
    </View>
  );
};

// ── Segmented Control ────────────────────────────────────────────────────────

export const SegmentedControl = ({ options, value, onChange, style }) => {
  const containerWidth = useRef(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const count = options.length || 1;

  useEffect(() => {
    const idx = options.findIndex(o => o === value);
    if (idx >= 0 && containerWidth.current > 0) {
      const segWidth = (containerWidth.current - 4) / count; // minus 4px total padding
      Animated.spring(slideAnim, {
        toValue: idx * segWidth,
        useNativeDriver: false,
        tension: 68,
        friction: 12,
      }).start();
    }
  }, [value, options]);

  const handleLayout = (e) => {
    containerWidth.current = e.nativeEvent.layout.width;
    const idx = options.findIndex(o => o === value);
    if (idx >= 0) {
      const segWidth = (e.nativeEvent.layout.width - 4) / count;
      slideAnim.setValue(idx * segWidth);
    }
  };

  return (
    <View style={[s.segWrap, style]} onLayout={handleLayout}>
      {/* Animated active indicator */}
      <Animated.View
        style={[
          s.segIndicator,
          {
            width: containerWidth.current > 0 ? (containerWidth.current - 4) / count : `${100 / count}%`,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      />
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={s.segOption}
          onPress={() => onChange(opt)}
          activeOpacity={0.7}
        >
          <Text style={[s.segText, value === opt && s.segTextActive]}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const P = 12; // page padding
const s = StyleSheet.create({
  sectionHeader: { paddingHorizontal: P, paddingTop: 9, paddingBottom: 3, fontSize: 11, fontWeight: '600', color: '#5a5550' },
  card: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1, overflow: 'hidden' },
  cardSelected: { borderWidth: 1.5, borderColor: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 8, minHeight: 40 },
  rowLabel: { flex: 1, fontSize: 13, fontWeight: '400', color: colors.text },
  rowValue: { fontSize: 12, fontWeight: '300', color: colors.textMuted },
  chevron: { color: '#c8c4bc', fontSize: 11, marginLeft: 2 },
  metricStrip: { flexDirection: 'row', marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  metricCell: { flex: 1, paddingVertical: 9, paddingHorizontal: 5, alignItems: 'center' },
  metricCellBorder: { borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  metricLabel: { fontSize: 8, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metricValue: { fontSize: 17, fontWeight: '500', color: colors.text, lineHeight: 20 },
  metricSub: { fontSize: 8, fontWeight: '300', color: colors.textMuted },
  condLayer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: P, paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, position: 'relative', gap: 9 },
  condBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  condIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  condMain: { flex: 1 },
  condName: { fontSize: 11, fontWeight: '500', color: colors.text, marginBottom: 1 },
  condDesc: { fontSize: 9.5, fontWeight: '300', color: colors.textMuted },
  condMeter: { marginTop: 4, height: 2.5, backgroundColor: colors.borderLight, borderRadius: 2, overflow: 'hidden' },
  condFill: { height: '100%', borderRadius: 2 },
  condRight: { alignItems: 'flex-end' },
  condVal: { fontSize: 18, fontWeight: '500', lineHeight: 20 },
  condUnit: { fontSize: 8.5, fontWeight: '300', color: colors.textMuted },
  primaryBtn: { marginHorizontal: P, marginBottom: 9, backgroundColor: colors.text, borderRadius: 9, padding: 12, alignItems: 'center' },
  primaryBtnText: { fontSize: 13.5, fontWeight: '500', color: colors.bg },
  ghostBtn: { marginHorizontal: P, marginBottom: 9, borderRadius: 9, padding: 11, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  ghostBtnText: { fontSize: 13, fontWeight: '400', color: colors.textMid },
  sosBtn: { marginHorizontal: P, marginBottom: 9, backgroundColor: colors.sos, borderRadius: 9, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, shadowColor: colors.sos, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  sosIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosIconText: { fontSize: 13, fontWeight: '700', color: 'white' },
  sosBtnText: { fontSize: 13, fontWeight: '600', color: 'white' },
  sosSubText: { fontSize: 9, fontWeight: '300', color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  stopBtn: { marginHorizontal: P, marginBottom: 9, backgroundColor: colors.warnLight, borderRadius: 9, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.warnBorder },
  stopBtnText: { fontSize: 13.5, fontWeight: '500', color: colors.warn },
  alert: { marginHorizontal: P, marginBottom: 8, borderRadius: 8, padding: 9, paddingHorizontal: 11, borderWidth: 1 },
  alertTitle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  alertBody: { fontSize: 10.5, fontWeight: '300', lineHeight: 16 },
  progressWrap: { paddingHorizontal: P, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  progressLabel: { fontSize: 9.5, fontWeight: '300', color: colors.textMuted },
  progressPct: { fontSize: 9.5, fontWeight: '500' },
  progressTrack: { height: 3, backgroundColor: '#e5e2db', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  authBtn: { width: '100%', padding: 12, paddingHorizontal: 16, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 9 },
  authBtnDark: { backgroundColor: colors.text },
  authBtnLight: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  authLogo: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  authBtnText: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '400' },
  authBtnTextDark: { color: colors.bg },
  authBtnTextLight: { color: colors.text },
  toggle: { width: 38, height: 22, borderRadius: 11, position: 'relative' },
  toggleOn: { backgroundColor: colors.good },
  toggleOff: { backgroundColor: '#e5e2db' },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'white', position: 'absolute', top: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 1, elevation: 2 },
  toggleThumbOn: { right: 2 },
  toggleThumbOff: { left: 2 },
  campsiteCard: { marginHorizontal: P, marginBottom: 8, backgroundColor: colors.white, borderRadius: 9, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 0.5 }, shadowOpacity: 0.07, shadowRadius: 2, elevation: 1 },
  campsiteCardSelected: { borderWidth: 1.5, borderColor: colors.text },
  campsiteHeader: { flexDirection: 'row', alignItems: 'center', padding: P - 1, gap: 8, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  campsiteIcon: { width: 26, height: 26, borderRadius: 6, backgroundColor: colors.campLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  campsiteIconText: { fontSize: 13 },
  campsiteName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  campsiteDist: { fontSize: 11, fontWeight: '300', color: colors.textMuted },
  campsiteStats: { flexDirection: 'row' },
  campStat: { flex: 1, padding: 7, paddingHorizontal: 10, borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  campStatL: { fontSize: 7.5, fontWeight: '400', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  campStatV: { fontSize: 12, fontWeight: '500', color: colors.text },
  tabBar: { flexDirection: 'row', marginHorizontal: P, marginBottom: 8, backgroundColor: '#e1e0db', borderRadius: 8, padding: 2, gap: 2 },
  tab: { flex: 1, padding: 7, alignItems: 'center', borderRadius: 6 },
  tabActive: { backgroundColor: colors.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  tabText: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  tabTextActive: { fontWeight: '600', color: colors.text },
  // Slider
  sliderWrap: { marginHorizontal: P, marginBottom: 8 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sliderLabel: { fontSize: 12, fontWeight: '500', color: colors.text },
  sliderValueLabel: { fontSize: 13, fontWeight: '600', color: colors.good },
  sliderTrack: { height: 6, backgroundColor: '#e5e2db', borderRadius: 3, position: 'relative', justifyContent: 'center' },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.good, borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, marginLeft: -11, top: -8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3, borderWidth: 2, borderColor: colors.good },
  sliderMinMax: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderBound: { fontSize: 9, fontWeight: '300', color: colors.textMuted },
  // Segmented Control
  segWrap: { flexDirection: 'row', marginHorizontal: P, marginBottom: 8, backgroundColor: '#e1e0db', borderRadius: 8, padding: 2, position: 'relative', overflow: 'hidden' },
  segIndicator: { position: 'absolute', top: 2, bottom: 2, left: 2, backgroundColor: colors.white, borderRadius: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  segOption: { flex: 1, padding: 8, alignItems: 'center', zIndex: 1 },
  segText: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  segTextActive: { fontWeight: '600', color: colors.text },
});
