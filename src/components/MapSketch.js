import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Rect, Line, Ellipse } from 'react-native-svg';
import { colors } from '../theme';

/**
 * MapSketch — CSS-drawn map used across Home, Routes, Tracking, Campsites.
 *
 * Supports maritime coordinate arrays: when `maritimeCoords` is provided
 * (an array of {lat, lon} or [lat, lon] waypoints), the component projects
 * them into the SVG viewBox and draws a route path automatically. This
 * allows denser maritime-first coordinate arrays to render correctly
 * without manually crafting SVG `d` strings.
 *
 * Props:
 *   height          number   (required)
 *   routes          array    [{type:'solid'|'dashed'|'faint', d:string, color?}]
 *   maritimeCoords  array    [{lat,lon}] or [[lat,lon]] — projected into SVG automatically
 *   waypoints       array    [{x, y, type:'start'|'end'|'mid'|'camp'|'paddler'|'vessel'}]
 *   myPos           {x, y}   current position marker (blue dot with pulse)
 *   heading         number   compass heading in degrees (0-360) for directional arrow
 *   overlayTitle    string
 *   overlayMeta     string
 *   windChip        string   top-left overlay
 *   etaChip         string   bottom-right overlay (number, label below)
 *   showLegend      object   {paddlers?, vessels?, campsites?, routes?}
 *   locationPin     {x, y, label?}  searched location pin marker (red pin with label)
 *   children        extra SVG elements
 */

/**
 * Project an array of geographic coordinates into SVG viewBox pixel space.
 * Handles both [{lat, lon}] objects and [[lat, lon]] arrays (Claude format).
 * Uses a simple Mercator-like projection bounded by the provided SVG dimensions,
 * with 10% padding so the route doesn't touch the edges.
 *
 * @param {Array} coords - [{lat,lon}] or [[lat,lon]]
 * @param {number} svgW - SVG viewBox width
 * @param {number} svgH - SVG viewBox height
 * @returns {Array<{x: number, y: number}>}
 */
export function projectCoordsToSvg(coords, svgW, svgH) {
  if (!Array.isArray(coords) || coords.length === 0) return [];

  const pts = coords.map(c => {
    if (Array.isArray(c)) return { lat: parseFloat(c[0]), lon: parseFloat(c[1]) };
    return { lat: parseFloat(c.lat), lon: parseFloat(c.lon) };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lon));

  if (pts.length === 0) return [];

  const lats = pts.map(p => p.lat);
  const lons = pts.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  const latRange = maxLat - minLat || 0.001;
  const lonRange = maxLon - minLon || 0.001;

  const pad = 0.1; // 10% padding
  const drawW = svgW * (1 - 2 * pad);
  const drawH = svgH * (1 - 2 * pad);

  return pts.map(p => ({
    x: svgW * pad + ((p.lon - minLon) / lonRange) * drawW,
    y: svgH * pad + ((maxLat - p.lat) / latRange) * drawH, // invert Y for SVG
  }));
}

/**
 * Build an SVG path `d` string from an array of {x, y} points.
 * @param {Array<{x: number, y: number}>} points
 * @returns {string}
 */
export function buildSvgPathFromPoints(points) {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
export default function MapSketch({
  height = 240,
  routes = [],
  maritimeCoords,
  waypoints = [],
  myPos,
  heading,
  overlayTitle,
  overlayMeta,
  windChip,
  etaChip,
  showLegend,
  locationPin,
  children,
}) {
  const W = 276; // internal SVG width matches phone inner width

  // Project maritime coordinates into SVG space if provided
  const projectedPoints = maritimeCoords ? projectCoordsToSvg(maritimeCoords, W, height) : [];
  const maritimePath = buildSvgPathFromPoints(projectedPoints);

  return (
    <View style={[styles.container, { height }]}>
      {/* Base terrain */}
      <View style={[styles.water, { height }]} />

      {/* Land masses — left headland */}
      <View style={[styles.land, { top: 0, left: 0, width: 100, height: height * 0.75, borderBottomRightRadius: 32 }]} />
      {/* Right headland */}
      <View style={[styles.land, { top: 0, right: 0, width: 80, height: height * 0.6, borderBottomLeftRadius: 24 }]} />
      {/* Beach strip bottom */}
      <View style={[styles.shore, { bottom: 0, left: 0, right: 0, height: height * 0.22 }]} />
      {/* Green parkland */}
      <View style={[styles.green, { top: 14, left: 12, width: 52, height: 44, borderRadius: 6 }]} />
      <View style={[styles.green, { top: 10, right: 12, width: 38, height: 34, borderRadius: 5 }]} />
      {/* Deep water tint */}
      <View style={[styles.deepWater, { top: height * 0.3, left: '30%', right: '25%', bottom: height * 0.26, borderRadius: 32 }]} />

      {/* SVG layer — routes, waypoints, dots */}
      <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${W} ${height}`}>

        {/* Routes */}
        {routes.map((r, i) => (
          <Path
            key={i}
            d={r.d}
            stroke={r.color || colors.mapRoute}
            strokeWidth={r.type === 'solid' ? 2.5 : r.type === 'dashed' ? 2 : 1.5}
            strokeDasharray={r.type === 'solid' ? undefined : r.type === 'dashed' ? '5,3' : '3,5'}
            fill="none"
            strokeLinecap="round"
            opacity={r.type === 'solid' ? 0.88 : r.type === 'dashed' ? 0.55 : 0.28}
          />
        ))}

        {/* Maritime route — auto-projected from lat/lon coordinates */}
        {maritimePath ? (
          <Path
            d={maritimePath}
            stroke={colors.mapRoute}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            opacity={0.88}
          />
        ) : null}

        {/* Maritime waypoint markers — start and end */}
        {projectedPoints.length > 0 && (
          <>
            <Circle cx={projectedPoints[0].x} cy={projectedPoints[0].y} r={5.5} fill={colors.good} stroke="white" strokeWidth={2} />
            <Circle cx={projectedPoints[projectedPoints.length - 1].x} cy={projectedPoints[projectedPoints.length - 1].y} r={5.5} fill={colors.warn} stroke="white" strokeWidth={2} opacity={0.85} />
          </>
        )}

        {children}

        {/* Waypoints */}
        {waypoints.map((wp, i) => {
          if (wp.type === 'start') return (
            <Circle key={i} cx={wp.x} cy={wp.y} r={5.5} fill={colors.good} stroke="white" strokeWidth={2} />
          );
          if (wp.type === 'end') return (
            <Circle key={i} cx={wp.x} cy={wp.y} r={5.5} fill={colors.warn} stroke="white" strokeWidth={2} opacity={0.85} />
          );
          if (wp.type === 'mid') return (
            <Circle key={i} cx={wp.x} cy={wp.y} r={3.5} fill={colors.blue} stroke="white" strokeWidth={1.5} />
          );
          if (wp.type === 'camp') return (
            <Circle key={i} cx={wp.x} cy={wp.y} r={4.5} fill={colors.camp} stroke="white" strokeWidth={1.5} opacity={wp.faded ? 0.55 : 1} />
          );
          if (wp.type === 'paddler') return (
            <Circle key={i} cx={wp.x} cy={wp.y} r={3.5} fill={colors.blue} stroke="white" strokeWidth={1.5} />
          );
          if (wp.type === 'vessel') return (
            <Rect key={i} x={wp.x - 4} y={wp.y - 4} width={8} height={8} rx={1.5} fill="#7a5a8a" stroke="white" strokeWidth={1.5} transform={`rotate(45 ${wp.x} ${wp.y})`} />
          );
          return null;
        })}

        {/* Location pin — searched/geocoded location marker */}
        {locationPin && (
          <>
            {/* Drop shadow */}
            <Ellipse
              cx={locationPin.x}
              cy={locationPin.y + 2}
              rx={6}
              ry={2.5}
              fill="rgba(0,0,0,0.18)"
            />
            {/* Pin body — teardrop shape */}
            <Path
              d={`M ${locationPin.x} ${locationPin.y} C ${locationPin.x - 7} ${locationPin.y - 5}, ${locationPin.x - 7} ${locationPin.y - 16}, ${locationPin.x} ${locationPin.y - 19} C ${locationPin.x + 7} ${locationPin.y - 16}, ${locationPin.x + 7} ${locationPin.y - 5}, ${locationPin.x} ${locationPin.y} Z`}
              fill={colors.warn}
              stroke="white"
              strokeWidth={1.5}
            />
            {/* Inner circle */}
            <Circle
              cx={locationPin.x}
              cy={locationPin.y - 12}
              r={3.5}
              fill="white"
              opacity={0.9}
            />
          </>
        )}

        {/* My position — blue dot with pulse halo and directional heading arrow */}
        {myPos && (
          <>
            {/* Outer pulse ring */}
            <Circle cx={myPos.x} cy={myPos.y} r={12} fill={`${colors.blue}12`} />
            {/* Inner halo */}
            <Circle cx={myPos.x} cy={myPos.y} r={8} fill={`${colors.blue}28`} />
            {/* Core blue dot */}
            <Circle cx={myPos.x} cy={myPos.y} r={5} fill={colors.blue} stroke="white" strokeWidth={2} />
            {/* Heading arrow — rotates based on compass heading */}
            <Path
              d={`M ${myPos.x} ${myPos.y - 9} L ${myPos.x - 3.5} ${myPos.y - 15} L ${myPos.x + 3.5} ${myPos.y - 15} Z`}
              fill={colors.blue}
              opacity={0.8}
              transform={heading != null ? `rotate(${heading} ${myPos.x} ${myPos.y})` : undefined}
            />
          </>
        )}

        {/* Compass */}
        <Circle cx={W - 18} cy={18} r={10} fill="rgba(255,255,255,0.82)" />
        <Path d={`M ${W - 18} 10 L ${W - 20} 18 L ${W - 18} 16 L ${W - 16} 18 Z`} fill={colors.text} />
      </Svg>

      {/* Location pin label — HTML overlay positioned above the pin */}
      {locationPin && locationPin.label && (
        <View style={[styles.pinLabel, { left: locationPin.x - 40, top: Math.max(4, (locationPin.y / height) * 100 - 18) + '%' }]}>
          <Text style={styles.pinLabelText} numberOfLines={1}>{locationPin.label}</Text>
        </View>
      )}

      {/* Wind chip — top left */}
      {windChip && (
        <View style={styles.windChip}>
          <Text style={styles.windChipMain}>{windChip.main}</Text>
          {windChip.sub && <Text style={styles.windChipSub}>{windChip.sub}</Text>}
        </View>
      )}

      {/* Legend */}
      {showLegend && (
        <View style={styles.legend}>
          {showLegend.routes?.map((r, i) => (
            <View key={i} style={styles.legendRow}>
              <View style={[styles.legendLine, { backgroundColor: r.color || colors.mapRoute, opacity: r.faint ? 0.55 : 1 }]} />
              <Text style={styles.legendText}>{r.label}</Text>
            </View>
          ))}
          {showLegend.paddlers && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.blue }]} />
              <Text style={styles.legendText}>{showLegend.paddlers}</Text>
            </View>
          )}
          {showLegend.vessels && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: '#7a5a8a', borderRadius: 1.5, transform: [{ rotate: '45deg' }] }]} />
              <Text style={styles.legendText}>{showLegend.vessels}</Text>
            </View>
          )}
          {showLegend.campsites && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.camp }]} />
              <Text style={styles.legendText}>{showLegend.campsites}</Text>
            </View>
          )}
        </View>
      )}

      {/* ETA chip — bottom right */}
      {etaChip && (
        <View style={styles.etaChip}>
          <Text style={styles.etaNum}>{etaChip.value}</Text>
          <Text style={styles.etaLabel}>{etaChip.label}</Text>
        </View>
      )}

      {/* Bottom overlay card */}
      {(overlayTitle || overlayMeta) && (
        <View style={styles.overlay}>
          {overlayTitle && <Text style={styles.overlayTitle}>{overlayTitle}</Text>}
          {overlayMeta && <Text style={styles.overlayMeta}>{overlayMeta}</Text>}
        </View>
      )}

      {/* Attribution */}
      <Text style={styles.attr}>{'\u00A9'} OpenStreetMap</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden', flexShrink: 0 },
  water:     { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.mapWater },
  land:      { position: 'absolute', backgroundColor: colors.mapLand, borderWidth: 0.5, borderColor: colors.mapLandBorder },
  shore:     { position: 'absolute', backgroundColor: colors.mapLandShore, borderTopWidth: 0.5, borderTopColor: colors.mapLandBorder },
  green:     { position: 'absolute', backgroundColor: colors.mapGreen },
  deepWater: { position: 'absolute', backgroundColor: colors.mapDeepWater, opacity: 0.55 },
  windChip: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(248,247,243,0.92)',
    borderRadius: 6, padding: 5, paddingHorizontal: 8,
  },
  windChipMain: { fontSize: 9.5, fontWeight: '500', color: colors.caution },
  windChipSub:  { fontSize: 8.5, fontWeight: '300', color: colors.textMuted, marginTop: 1 },
  legend: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(248,247,243,0.9)',
    borderRadius: 6, padding: 5, paddingHorizontal: 8,
  },
  legendRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  legendLine: { width: 12, height: 2, borderRadius: 1 },
  legendDot:  { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: 'white' },
  legendText: { fontSize: 8, fontWeight: '400', color: colors.text },
  etaChip: {
    position: 'absolute', bottom: 52, right: 8,
    backgroundColor: 'rgba(248,247,243,0.9)',
    borderRadius: 6, padding: 4, paddingHorizontal: 8, alignItems: 'center',
  },
  etaNum:   { fontSize: 14, fontWeight: '500', color: colors.text, lineHeight: 16 },
  etaLabel: { fontSize: 7.5, fontWeight: '300', color: colors.textMuted },
  // Location pin label
  pinLabel: {
    position: 'absolute', width: 80, alignItems: 'center',
  },
  pinLabelText: {
    fontSize: 8, fontWeight: '500', color: colors.text,
    backgroundColor: 'rgba(248,247,243,0.9)',
    borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1,
    overflow: 'hidden', textAlign: 'center',
  },
  overlay: {
    position: 'absolute', bottom: 9, left: 9, right: 9,
    backgroundColor: 'rgba(248,247,243,0.93)',
    borderRadius: 8, padding: 9, paddingHorizontal: 11,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.11, shadowRadius: 7, elevation: 3,
  },
  overlayTitle: { fontSize: 12.5, fontWeight: '600', color: colors.text, marginBottom: 2 },
  overlayMeta:  { fontSize: 10, fontWeight: '300', color: colors.textMid },
  attr: {
    position: 'absolute', bottom: 3, right: 5,
    fontSize: 6.5, fontWeight: '300', color: 'rgba(0,0,0,0.28)',
  },
});
