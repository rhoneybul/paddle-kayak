// ── Paddle App Theme ─────────────────────────────────────────────────────────
// Light, functional, map-focused. Single font: Inter.
// Colour only for meaning (good/caution/warn), never decoration.

export const colors = {
  bg:           '#f5f6f8',   // app background
  bgDeep:       '#eceef3',   // sunken areas
  white:        '#ffffff',
  border:       '#e0e4ef',   // strong border
  borderLight:  '#edf0f7',   // subtle divider
  text:         '#111827',   // primary text
  textMid:      '#4b5563',   // secondary text
  textMuted:    '#9ca3af',   // labels / captions
  textFaint:    '#d1d5db',   // placeholders
  // Primary action colour
  primary:      '#2563EB',
  primaryLight: '#eff4ff',
  primaryDark:  '#1d4ed8',
  // Functional status — use sparingly
  good:         '#16a34a',
  goodLight:    '#f0fdf4',
  caution:      '#d97706',
  cautionLight: '#fffbeb',
  cautionBorder:'#fde68a',
  warn:         '#dc2626',
  warnLight:    '#fef2f2',
  warnBorder:   '#fecaca',
  blue:         '#2563EB',
  blueLight:    '#eff4ff',
  camp:         '#8a5a2a',
  campLight:    '#8a5a2a18',
  sos:          '#7a2020',
  // Map palette
  mapWater:     '#bfdbfe',
  mapLand:      '#e5e7eb',
  mapLandShore: '#d1d5db',
  mapLandBorder:'#9ca3af',
  mapGreen:     '#bbf7d0',
  mapDeepWater: '#93c5fd',
  mapRoute:     '#2563EB',
  mapRouteAlt:  '#9ca3af',
};

export const font = {
  // Inter weights only — never bold outside of headings
  thin:    '300',
  regular: '400',
  medium:  '500',
  semibold:'600',
};

export const text = {
  heading:    { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  subheading: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  body:       { fontSize: 13, fontWeight: '400', color: '#1a1a1a' },
  bodyLight:  { fontSize: 13, fontWeight: '300', color: '#5a5550' },
  small:      { fontSize: 11, fontWeight: '300', color: '#6a6560' },
  label:      { fontSize: 8,  fontWeight: '400', color: '#a09890', textTransform: 'uppercase', letterSpacing: 0.5 },
  metric:     { fontSize: 22, fontWeight: '300', color: '#1a1a1a' },
  metricMd:   { fontSize: 17, fontWeight: '500', color: '#1a1a1a' },
  caption:    { fontSize: 9.5,fontWeight: '300', color: '#9a9590' },
};

export const layout = {
  pagePad:    16,
  cardRadius: 14,
  cardShadow: {
    shadowColor: '#1e3a8a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  card: (extra = {}) => ({
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#edf0f7',
    shadowColor: '#1e3a8a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    ...extra,
  }),
};

// Shared handle for bottom sheets
export const sheetHandle = {
  width: 36, height: 4, borderRadius: 2,
  backgroundColor: '#d1d5db',
  alignSelf: 'center',
  marginTop: 8, marginBottom: 6,
};
