import { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Polyline, Marker, Callout } from 'react-native-maps';
import { colors } from '../theme';
import { CrosshairIcon } from './Icons';

export function parseGpx(gpx) {
  if (!gpx) return [];
  // Array of [lat, lon] pairs (preferred format from Claude)
  if (Array.isArray(gpx)) {
    return gpx
      .filter(p => Array.isArray(p) && p.length >= 2)
      .map(p => ({ latitude: parseFloat(p[0]), longitude: parseFloat(p[1]) }))
      .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude));
  }
  // Legacy GPX XML string fallback
  const matches = [...gpx.matchAll(/lat="([^"]+)"\s+lon="([^"]+)"/g)];
  return matches
    .map(m => ({ latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) }))
    .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude));
}

/**
 * Compute the bearing (degrees) from the first to last point of a GPX route.
 * Returns null if fewer than 2 points.
 */
export function gpxRouteBearing(gpx) {
  const pts = parseGpx(gpx);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last  = pts[pts.length - 1];
  const dLon  = (last.longitude - first.longitude) * Math.PI / 180;
  const lat1  = first.latitude  * Math.PI / 180;
  const lat2  = last.latitude   * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function fitRegion(coordSets) {
  const all = coordSets.flat();
  if (all.length === 0) return null;
  const lats = all.map(c => c.latitude);
  const lons = all.map(c => c.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return {
    latitude:       (minLat + maxLat) / 2,
    longitude:      (minLon + maxLon) / 2,
    latitudeDelta:  Math.max((maxLat - minLat) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLon - minLon) * 1.6, 0.02),
  };
}

function haversineKmNative(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function extractCriticalPointsNative(pts, minBearingChange = 35, maxPts = 8) {
  if (pts.length === 0) return [];
  if (pts.length <= 2) return pts;
  function brng(a, b) {
    const dLon = (b.longitude - a.longitude) * Math.PI / 180;
    const lat1 = a.latitude * Math.PI / 180, lat2 = b.latitude * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }
  function bDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  const result = [pts[0]];
  let prevB = brng(pts[0], pts[1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const nextB = brng(pts[i], pts[i + 1]);
    if (bDiff(prevB, nextB) >= minBearingChange) { result.push(pts[i]); prevB = nextB; }
  }
  result.push(pts[pts.length - 1]);
  if (result.length > maxPts) {
    return Array.from({ length: maxPts }, (_, i) =>
      result[Math.round((i / (maxPts - 1)) * (result.length - 1))]);
  }
  return result;
}

const ROUTE_COLORS = [colors.primary, colors.caution, colors.textMid];

// Greyscale / muted Google Maps style (Android)
const GREY_MAP_STYLE = [
  { elementType: 'geometry',        stylers: [{ saturation: -100 }, { lightness: 5  }] },
  { elementType: 'labels.text.fill',stylers: [{ color: '#9e9e9e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d8e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7a9aac' }] },
  { featureType: 'road',  elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road',  elementType: 'geometry.stroke', stylers: [{ color: '#e0e0e0' }] },
  { featureType: 'poi',   elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d4e4d8' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f2f1ed' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d0cec8' }] },
];

/**
 * PaddleMap (native) — shows GPX routes as polylines on real map tiles.
 * The route at `selectedIdx` is drawn thick + solid; others are thin + dashed.
 */
export default function PaddleMap({
  height = 300,
  coords,
  routes = [],
  selectedIdx = 0,
  overlayTitle,
  overlayMeta,
  drawMode = false,
  drawnPoints = [],
  onAddPoint,
  onMovePoint,
  simpleRoute = false,
  liveTrack = [],
  staticView = false,
  campsites = [],
}) {
  const mapRef = useRef(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [landmarks, setLandmarks]         = useState([]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}&limit=5`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Solvaa/1.0' } });
      const data = await resp.json();
      const results = data.map(r => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name.split(',').slice(0, 2).join(',') }));
      setLandmarks(results);

      // Fit map to show both the route and all landmark results
      if (results.length > 0 && mapRef.current) {
        const routeCoords = parsed.flatMap(r => r.points);
        const lmCoords    = results.map(r => ({ latitude: r.lat, longitude: r.lon }));
        const allCoords   = [...routeCoords, ...lmCoords];
        mapRef.current.fitToCoordinates(allCoords.length > 0 ? allCoords : lmCoords, {
          edgePadding: { top: 60, right: 60, bottom: 80, left: 60 },
          animated: true,
        });
      }
    } catch { /* ignore */ }
    finally { setSearchLoading(false); }
  };
  const parsed = useMemo(
    () => routes.map((r, i) => ({
      points: parseGpx(r.waypoints || ''),
      color:  ROUTE_COLORS[i] || ROUTE_COLORS[0],
      idx: i,
    })),
    [routes],
  );

  // Overview mode (selectedIdx = -1): fit all routes; otherwise fit selected
  const fitPoints = useMemo(() => {
    if (selectedIdx >= 0) {
      const sel = parsed[selectedIdx];
      if (sel && sel.points.length > 0) return [sel.points];
    }
    return parsed.filter(r => r.points.length > 0).map(r => r.points);
  }, [parsed, selectedIdx]);

  const region = useMemo(() => {
    if (fitPoints.length > 0) return fitRegion(fitPoints);
    if (coords) return { latitude: coords.lat, longitude: coords.lon, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    return null;
  }, [fitPoints, coords]);

  const selectedRoute = parsed[selectedIdx];

  // Detect out-and-back: start and end within 300 m of each other
  const selRaw = selectedRoute?.points || [];
  const isOutAndBack = selRaw.length >= 2 && (() => {
    const a = selRaw[0], b = selRaw[selRaw.length - 1];
    const R = 6371000;
    const dLat = (b.latitude - a.latitude) * Math.PI / 180;
    const dLon = (b.longitude - a.longitude) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) < 300;
  })();

  const midPoint = selRaw.length >= 2 ? selRaw[Math.floor(selRaw.length / 2)] : null;

  const fitToRoute = () => {
    const routePts = fitPoints.flat();
    const drawnCoords = drawnPoints.map(p => ({ latitude: p.lat, longitude: p.lon }));
    const allPts = [...routePts, ...drawnCoords];
    const pts = allPts.length > 0 ? allPts : routePts;
    if (pts.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(pts, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }
  };

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        ref={mapRef}
        key={selectedIdx}
        style={StyleSheet.absoluteFill}
        initialRegion={region ?? undefined}
        customMapStyle={GREY_MAP_STYLE}
        onPress={drawMode && onAddPoint
          ? e => onAddPoint({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })
          : undefined}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        zoomEnabled={!staticView}
        scrollEnabled={!staticView}
        pitchEnabled={false}
      >
        {/* Location pin when no routes yet */}
        {parsed.every(r => r.points.length === 0) && coords && (
          <Marker coordinate={{ latitude: coords.lat, longitude: coords.lon }}>
            <View style={styles.markerWrap}>
              {overlayTitle ? (
                <View style={styles.markerLabel}>
                  <Text style={[styles.markerLabelText, { color: colors.primary }]} numberOfLines={1}>
                    {overlayTitle}
                  </Text>
                </View>
              ) : null}
              <View style={styles.markerStart} />
            </View>
          </Marker>
        )}

        {/* Unselected routes — full overview or ghosted start→end */}
        {parsed.map(r => {
          if (r.idx === selectedIdx || r.points.length < 2) return null;
          const isOverview = selectedIdx === -1;
          if (isOverview) {
            return (
              <Polyline
                key={r.idx}
                coordinates={r.points}
                strokeColor={r.color + '99'}
                strokeWidth={2}
                lineDashPattern={[6, 3]}
              />
            );
          }
          return (
            <Polyline
              key={r.idx}
              coordinates={[r.points[0], r.points[r.points.length - 1]]}
              strokeColor={r.color + '55'}
              strokeWidth={1.5}
              lineDashPattern={[4, 4]}
            />
          );
        })}

        {/* Selected route — polyline */}
        {selectedRoute && selectedRoute.points.length >= 2 && (
          <Polyline
            coordinates={selectedRoute.points}
            strokeColor={selectedRoute.color}
            strokeWidth={3}
          />
        )}

        {/* Selected route — key waypoint markers (skipped for drawn/simple routes) */}
        {(() => {
          const route = routes[selectedIdx];
          if (route?.isDrawn || simpleRoute) return null;
          const pts  = (parsed[selectedIdx]?.points) || [];
          const kps  = extractCriticalPointsNative(pts);
          const col  = parsed[selectedIdx]?.color || colors.primary;
          return kps.map((kp, i) => (
            <Marker key={`kp${i}`} coordinate={kp} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[
                styles.kpDot,
                { backgroundColor: i === 0 ? col : i === kps.length - 1 ? colors.warn : col },
                (i === 0 || i === kps.length - 1) && styles.kpDotLarge,
              ]} />
            </Marker>
          ));
        })()}

        {/* Drawn route points — draggable in draw mode */}
        {drawnPoints.map((pt, i) => (
          <Marker
            key={`dp${i}`}
            coordinate={{ latitude: pt.lat, longitude: pt.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            draggable={drawMode && !!onMovePoint}
            onDragEnd={onMovePoint ? e => onMovePoint(i, { lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude }) : undefined}
          >
            <View style={[styles.kpDot, i === 0 ? styles.kpDotStart : styles.kpDotDrawn]} />
          </Marker>
        ))}
        {drawnPoints.length >= 2 && (
          <Polyline
            coordinates={drawnPoints.map(p => ({ latitude: p.lat, longitude: p.lon }))}
            strokeColor="#1d4ed8"
            strokeWidth={2.5}
          />
        )}

        {/* Live GPS track */}
        {liveTrack.length >= 2 && (
          <Polyline
            coordinates={liveTrack.map(p => ({ latitude: p.lat, longitude: p.lon }))}
            strokeColor={colors.good}
            strokeWidth={3}
          />
        )}
        {liveTrack.length >= 1 && (
          <Marker
            coordinate={{ latitude: liveTrack[liveTrack.length - 1].lat, longitude: liveTrack[liveTrack.length - 1].lon }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.liveDot} />
          </Marker>
        )}

        {/* Campsites */}
        {campsites.map((c, i) => (
          <Marker key={`cs${i}`} coordinate={{ latitude: c.lat, longitude: c.lon }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.campsiteDot} />
            <Callout>
              <View style={styles.landmarkCallout}>
                <Text style={styles.landmarkCalloutText}>{c.name}</Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Landmark search results */}
        {landmarks.map((lm, i) => (
          <Marker key={`lm${i}`} coordinate={{ latitude: lm.lat, longitude: lm.lon }}>
            <View style={styles.landmarkDot} />
            <Callout>
              <View style={styles.landmarkCallout}>
                <Text style={styles.landmarkCalloutText}>{lm.name}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Landmark search */}
      {searchVisible ? (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search landmarks…"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoFocus
          />
          {searchLoading
            ? <ActivityIndicator size="small" color={colors.primary} style={{ marginHorizontal: 6 }} />
            : <TouchableOpacity onPress={handleSearch} style={styles.searchGoBtn} activeOpacity={0.7}>
                <Text style={styles.searchGoBtnText}>Go</Text>
              </TouchableOpacity>
          }
          <TouchableOpacity onPress={() => { setSearchVisible(false); setSearchQuery(''); setLandmarks([]); }} style={styles.searchCloseBtn} activeOpacity={0.7}>
            <Text style={styles.searchCloseBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.searchOpenBtn} onPress={() => setSearchVisible(true)} activeOpacity={0.75}>
          <Text style={styles.searchOpenBtnText}>⌕</Text>
        </TouchableOpacity>
      )}

      {(overlayTitle || overlayMeta) && (
        <View style={styles.overlay}>
          {overlayTitle ? <Text style={styles.overlayTitle} numberOfLines={1}>{overlayTitle}</Text> : null}
          {overlayMeta  ? <Text style={styles.overlayMeta}  numberOfLines={1}>{overlayMeta}</Text>  : null}
        </View>
      )}

      {/* Center / fit button */}
      <TouchableOpacity style={styles.centerBtn} onPress={fitToRoute} activeOpacity={0.75}>
        <CrosshairIcon size={18} color={colors.primary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { overflow: 'hidden', backgroundColor: colors.mapWater },
  overlay: {
    position: 'absolute', bottom: 12, left: 12, right: 60,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  overlayTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  overlayMeta:  { fontSize: 11, fontWeight: '400', color: colors.textMuted, marginTop: 2 },
  markerWrap:   { alignItems: 'center' },
  markerLabel:  { backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginBottom: 3 },
  markerLabelText: { fontSize: 9, fontWeight: '600' },
  markerStart:  { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' },
  markerEnd:    { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.warn, borderWidth: 2, borderColor: '#fff' },
  markerMid:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', borderWidth: 2, borderColor: colors.textMid },
  kpDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' },
  kpDotLarge: { width: 12, height: 12, borderRadius: 6 },
  kpDotStart: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1d4ed8', borderWidth: 2, borderColor: '#fff' },
  kpDotDrawn: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', borderWidth: 2, borderColor: '#1d4ed8' },
  centerBtn:  { position: 'absolute', bottom: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 3 },
  centerBtnText: { fontSize: 18, color: colors.primary, lineHeight: 20 }, // unused — kept for safety
  // Live track
  liveDot:    { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.good, borderWidth: 2.5, borderColor: '#fff' },
  // Landmark search
  searchOpenBtn:   { position: 'absolute', bottom: 52, left: 8, width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.93)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  searchOpenBtnText: { fontSize: 17, color: colors.primary },
  searchBar:       { position: 'absolute', bottom: 52, left: 8, right: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', paddingHorizontal: 8, height: 34 },
  searchInput:     { flex: 1, fontSize: 12, color: colors.text, paddingVertical: 0 },
  searchGoBtn:     { paddingHorizontal: 8, paddingVertical: 4 },
  searchGoBtnText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  searchCloseBtn:  { paddingHorizontal: 6, paddingVertical: 4 },
  searchCloseBtnText: { fontSize: 12, color: colors.textMuted },
  campsiteDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#8a6a2a', borderWidth: 2, borderColor: '#fff' },
  landmarkDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.caution, borderWidth: 2, borderColor: '#fff' },
  landmarkCallout: { padding: 6, maxWidth: 160 },
  landmarkCalloutText: { fontSize: 11, color: colors.text },
});
