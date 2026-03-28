import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, Image, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { colors } from '../theme';

// ── Coordinate parsers (shared with native) ───────────────────────────────────

export function parseGpx(gpx) {
  if (!gpx) return [];
  if (Array.isArray(gpx)) {
    return gpx
      .filter(p => Array.isArray(p) && p.length >= 2)
      .map(p => ({ latitude: parseFloat(p[0]), longitude: parseFloat(p[1]) }))
      .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude));
  }
  const matches = [...gpx.matchAll(/lat="([^"]+)"\s+lon="([^"]+)"/g)];
  return matches
    .map(m => ({ latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) }))
    .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude));
}

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

/** Haversine distance in metres between two {latitude, longitude} points. */
function haversineM(a, b) {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ── Map tile config ───────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const PAD       = 0.30; // 30 % padding around route bounding box

/** Haversine distance in km between two {lat, lon} points (draw mode) */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** World pixel coords → {lat, lon} */
function worldToLatLon(wx, wy, zoom) {
  const lon = (wx / (TILE_SIZE * (1 << zoom))) * 360 - 180;
  const n   = Math.PI - (2 * Math.PI * wy) / (TILE_SIZE * (1 << zoom));
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

/** Extract critical navigation points: launch, significant turns, take-out.
 *  Never returns more than maxPts points. */
function extractCriticalPoints(pts, minBearingChange = 35, maxPts = 8) {
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

function difficultyColor(difficulty) {
  const d = (difficulty || '').toLowerCase();
  if (d === 'beginner' || d === 'easy')           return '#16a34a'; // green
  if (d === 'intermediate' || d === 'moderate')   return '#2563EB'; // blue
  if (d === 'advanced' || d === 'challenging')    return '#d97706'; // orange
  if (d === 'expert')                             return '#dc2626'; // red
  return '#2563EB';
}

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_STYLE = 'mapbox/light-v11';
const MAPBOX_SAT   = 'mapbox/satellite-streets-v12';

function tileUrl(zoom, x, y, layer = 'map') {
  if (layer === 'satellite') {
    if (MAPBOX_TOKEN) {
      return `https://api.mapbox.com/styles/v1/${MAPBOX_SAT}/tiles/256/${zoom}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
    }
    // ESRI World Imagery — free, no key (note: y/x order)
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
  }
  if (MAPBOX_TOKEN) {
    return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/256/${zoom}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
  }
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

function lonToWorld(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * (1 << zoom);
}

function latToWorld(lat, zoom) {
  const r = lat * Math.PI / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE_SIZE * (1 << zoom);
}

function calcZoom(bMinLon, bMaxLon, bMinLat, bMaxLat, vpW, vpH) {
  for (let z = 16; z >= 1; z--) {
    const pxW = lonToWorld(bMaxLon, z) - lonToWorld(bMinLon, z);
    const pxH = latToWorld(bMinLat, z) - latToWorld(bMaxLat, z);
    if (pxW <= vpW && pxH <= vpH) return z;
  }
  return 1;
}

// ── Web component ─────────────────────────────────────────────────────────────

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
  windHourly = [],
  windDate = null,
  onWindDateChange,
  simpleRoute = false,
  liveTrack = [],
  staticView = false,
  tideHeightMap = {},
  tideExtremeMap = {},
}) {
  const [vpW, setVpW] = useState(390);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [landmarks, setLandmarks]         = useState([]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      // Build a viewbox biased to the route area (helps Nominatim rank nearby results first)
      const rb = routeBoundsForFit;
      const centerLat = rb ? (rb.minLat + rb.maxLat) / 2 : coords?.lat ?? null;
      const centerLon = rb ? (rb.minLon + rb.maxLon) / 2 : coords?.lon ?? null;
      const viewbox = rb
        ? `&viewbox=${rb.minLon - 0.2},${rb.maxLat + 0.2},${rb.maxLon + 0.2},${rb.minLat - 0.2}&bounded=0`
        : '';
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}&limit=10${viewbox}`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Solvaa/1.0' } });
      const data = await resp.json();
      const all = data.map(r => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name.split(',').slice(0, 2).join(',') }));

      // Filter to results within 10 km of the route centre
      const nearby = centerLat != null && centerLon != null
        ? all.filter(r => {
            const R = 6371;
            const dLat = (r.lat - centerLat) * Math.PI / 180;
            const dLon = (r.lon - centerLon) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2
              + Math.cos(centerLat * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 10;
          })
        : all;

      setLandmarks(nearby);
    } catch { /* ignore */ }
    finally { setSearchLoading(false); }
  };
  const [zoomDelta, setZoomDelta] = useState(0);
  const [mapLayer, setMapLayer] = useState('map');
  const [windHour, setWindHour] = useState(9);
  const [dragPreview, setDragPreview] = useState(null); // { idx, lx, ly }
  const mapRef = useRef(null);
  const lastTapRef = useRef(0);
  const dragPointIdxRef = useRef(-1);

  // Derive sorted unique dates from hourly data
  const windDates = (() => {
    const seen = new Set();
    const out = [];
    for (const h of windHourly) {
      const d = h.time?.slice(0, 10);
      if (d && !seen.has(d)) { seen.add(d); out.push(d); }
    }
    return out; // all available days
  })();
  const activeWindDate = windDate ?? null; // only show when a date is explicitly selected

  // Reset zoom + pan when selected route changes
  useEffect(() => { setZoomDelta(0); }, [selectedIdx]);

  const panOffset = useRef({ x: 0, y: 0 });
  const [panState, setPanState] = useState({ x: 0, y: 0 });
  const dragStart = useRef(null);

  useEffect(() => { panOffset.current = { x: 0, y: 0 }; setPanState({ x: 0, y: 0 }); }, [selectedIdx, coords?.lat, coords?.lon]);

  // Web: wheel-to-zoom + pinch-to-zoom via DOM events
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (staticView) return;
    const el = mapRef.current;
    if (!el) return;

    const onWheel = (e) => {
      e.preventDefault();
      setZoomDelta(d => d - Math.sign(e.deltaY));
    };

    let pinchDist = null;
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || pinchDist === null) return;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (Math.abs(dist - pinchDist) > 20) {
        setZoomDelta(d => d + (dist > pinchDist ? 1 : -1));
        pinchDist = dist;
      }
    };
    const onTouchEnd = () => { pinchDist = null; };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // Bounding box of all route points (or coord pin) — used to fit map after search
  const routeBoundsForFit = useMemo(() => {
    const pts = routes.flatMap(r => parseGpx(r.waypoints || []));
    if (pts.length > 0) {
      const lats = pts.map(p => p.latitude);
      const lons = pts.map(p => p.longitude);
      return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
    }
    if (coords) return { minLat: coords.lat, maxLat: coords.lat, minLon: coords.lon, maxLon: coords.lon };
    return null;
  }, [routes, coords]);

  // Fit map to include route + landmark pins whenever search results arrive
  const vpWRef = useRef(vpW);
  useEffect(() => { vpWRef.current = vpW; }, [vpW]);

  useEffect(() => {
    if (landmarks.length === 0) return;
    const currentVpW = vpWRef.current;
    const rb = routeBoundsForFit;

    const lmLats = landmarks.map(l => l.lat);
    const lmLons = landmarks.map(l => l.lon);
    const allLats = rb ? [rb.minLat, rb.maxLat, ...lmLats] : lmLats;
    const allLons = rb ? [rb.minLon, rb.maxLon, ...lmLons] : lmLons;

    const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
    const minLon = Math.min(...allLons), maxLon = Math.max(...allLons);
    const dLat = Math.max(maxLat - minLat, 0.005);
    const dLon = Math.max(maxLon - minLon, 0.005);
    const pMinLat = minLat - dLat * 0.25, pMaxLat = maxLat + dLat * 0.25;
    const pMinLon = minLon - dLon * 0.25, pMaxLon = maxLon + dLon * 0.25;

    const targetZoom = Math.max(1, Math.min(18, calcZoom(pMinLon, pMaxLon, pMinLat, pMaxLat, currentVpW, height)));
    const targetCenterLon = (pMinLon + pMaxLon) / 2;
    const targetCenterLat = (pMinLat + pMaxLat) / 2;

    // Compute autoZoom for the route bounds (same formula as the main render path)
    let baseCenterLon, baseCenterLat, baseAutoZoom;
    if (rb) {
      const rbDLat = Math.max(rb.maxLat - rb.minLat, 0.004);
      const rbDLon = Math.max(rb.maxLon - rb.minLon, 0.004);
      baseAutoZoom = calcZoom(
        rb.minLon - rbDLon * PAD, rb.maxLon + rbDLon * PAD,
        rb.minLat - rbDLat * PAD, rb.maxLat + rbDLat * PAD,
        currentVpW, height,
      );
      baseCenterLon = (rb.minLon + rb.maxLon) / 2;
      baseCenterLat = (rb.minLat + rb.maxLat) / 2;
    } else {
      // Coords-only mode — base autoZoom is 11
      baseCenterLon = coords?.lon ?? targetCenterLon;
      baseCenterLat = coords?.lat ?? targetCenterLat;
      baseAutoZoom  = 11;
    }

    // Pan so that targetCenter is at screen center (see render formula derivation)
    const newPanX = lonToWorld(baseCenterLon, targetZoom) - lonToWorld(targetCenterLon, targetZoom);
    const newPanY = latToWorld(baseCenterLat, targetZoom) - latToWorld(targetCenterLat, targetZoom);

    panOffset.current = { x: newPanX, y: newPanY };
    setPanState({ x: newPanX, y: newPanY });
    setZoomDelta(targetZoom - baseAutoZoom);
  }, [landmarks]); // eslint-disable-line react-hooks/exhaustive-deps

  const allParsed = routes.map(r => parseGpx(r.waypoints || []));
  const allPts    = allParsed.flat();

  if (allPts.length === 0) {
    if (!coords) {
      return (
        <View style={{ height, backgroundColor: '#c8dce8', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>Map will appear here</Text>
        </View>
      );
    }
    // Render a pinned map centred on coords (no routes)
    const pinZoom = Math.max(1, Math.min(18, 11 + zoomDelta));
    const pinLat  = coords.lat;
    const pinLon  = coords.lon;
    const pcx     = lonToWorld(pinLon, pinZoom);
    const pcy     = latToWorld(pinLat, pinZoom);
    const pvpX    = pcx - vpW / 2 - panState.x;
    const pvpY    = pcy - height / 2 - panState.y;
    const ptxStart = Math.floor(pvpX / TILE_SIZE);
    const ptyStart = Math.floor(pvpY / TILE_SIZE);
    const ptxEnd   = Math.ceil((pvpX + vpW)    / TILE_SIZE);
    const ptyEnd   = Math.ceil((pvpY + height) / TILE_SIZE);
    const pnTiles  = (1 << pinZoom);
    const pinTiles = [];
    for (let tx = ptxStart; tx < ptxEnd; tx++) {
      for (let ty = ptyStart; ty < ptyEnd; ty++) {
        if (ty < 0 || ty >= pnTiles) continue;
        const tileX = ((tx % pnTiles) + pnTiles) % pnTiles;
        pinTiles.push({ key: `${tx}-${ty}`, tileX, ty, left: tx * TILE_SIZE - pvpX, top: ty * TILE_SIZE - pvpY });
      }
    }
    const pinScreenX = lonToWorld(pinLon, pinZoom) - pvpX;
    const pinScreenY = latToWorld(pinLat, pinZoom) - pvpY;
    return (
      <View
        ref={mapRef}
        style={{ width: '100%', height, overflow: 'hidden', backgroundColor: '#c8dce8', cursor: 'grab' }}
        onLayout={e => setVpW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={e => {
          const now = Date.now();
          if (now - lastTapRef.current < 300) setZoomDelta(d => d + 1);
          lastTapRef.current = now;
          dragStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, panX: panOffset.current.x, panY: panOffset.current.y };
        }}
        onResponderMove={e => {
          if (!dragStart.current) return;
          const dx = e.nativeEvent.pageX - dragStart.current.x;
          const dy = e.nativeEvent.pageY - dragStart.current.y;
          const nx = dragStart.current.panX + dx;
          const ny = dragStart.current.panY + dy;
          panOffset.current = { x: nx, y: ny };
          setPanState({ x: nx, y: ny });
        }}
        onResponderRelease={() => { dragStart.current = null; }}
      >
        {pinTiles.map(({ key, tileX, ty, left, top }) => (
          <Image
            key={key}
            source={{ uri: tileUrl(pinZoom, tileX, ty) }}
            style={{ position: 'absolute', left, top, width: TILE_SIZE, height: TILE_SIZE }}
          />
        ))}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Location pin */}
          <circle cx={pinScreenX} cy={pinScreenY} r={8} fill={colors.primary} stroke="#fff" strokeWidth={2.5} />
          <circle cx={pinScreenX} cy={pinScreenY} r={3} fill="#fff" />
          {overlayTitle && (
            <>
              <rect x={pinScreenX - 36} y={pinScreenY - 32} width={72} height={18} rx={5} fill="rgba(255,255,255,0.93)" />
              <text x={pinScreenX} y={pinScreenY - 19} textAnchor="middle" fontSize="9" fontWeight="600"
                fill={colors.primary} fontFamily="Inter, -apple-system, sans-serif">
                {overlayTitle.length > 18 ? overlayTitle.slice(0, 16) + '…' : overlayTitle}
              </text>
            </>
          )}
        </svg>
      </View>
    );
  }

  // Bounding box uses selected route's points so map zooms to fit it on selection change
  const selPts = allParsed[selectedIdx] || [];
  const boxPts = selPts.length >= 2 ? selPts : allPts;
  const lats   = boxPts.map(p => p.latitude);
  const lons   = boxPts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const dLat   = Math.max(maxLat - minLat, 0.004);
  const dLon   = Math.max(maxLon - minLon, 0.004);
  const bMinLat = minLat - dLat * PAD,  bMaxLat = maxLat + dLat * PAD;
  const bMinLon = minLon - dLon * PAD,  bMaxLon = maxLon + dLon * PAD;

  // Zoom — auto-fit + manual delta, clamped 1–18
  const autoZoom  = calcZoom(bMinLon, bMaxLon, bMinLat, bMaxLat, vpW, height);
  const zoom      = Math.max(1, Math.min(18, autoZoom + zoomDelta));

  const centerLon = (bMinLon + bMaxLon) / 2;
  const centerLat = (bMinLat + bMaxLat) / 2;
  const cx        = lonToWorld(centerLon, zoom);
  const cy        = latToWorld(centerLat, zoom);

  const vpX = cx - vpW / 2 - panState.x;
  const vpY = cy - height / 2 - panState.y;

  const txStart = Math.floor(vpX / TILE_SIZE);
  const tyStart = Math.floor(vpY / TILE_SIZE);
  const txEnd   = Math.ceil((vpX + vpW)    / TILE_SIZE);
  const tyEnd   = Math.ceil((vpY + height) / TILE_SIZE);
  const nTiles  = (1 << zoom);

  const tiles = [];
  for (let tx = txStart; tx < txEnd; tx++) {
    for (let ty = tyStart; ty < tyEnd; ty++) {
      if (ty < 0 || ty >= nTiles) continue;
      const tileX = ((tx % nTiles) + nTiles) % nTiles;
      tiles.push({ key: `${tx}-${ty}`, tileX, ty, left: tx * TILE_SIZE - vpX, top: ty * TILE_SIZE - vpY });
    }
  }

  const toScreen = (lat, lon) => ({
    x: lonToWorld(lon, zoom) - vpX,
    y: latToWorld(lat, zoom) - vpY,
  });

  const svgRoutes = allParsed.map((pts, i) => {
    if (pts.length < 2) return null;
    const sp = pts.map(p => toScreen(p.latitude, p.longitude));
    const d  = 'M' + sp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
    const r  = routes[i];
    return { d, selected: i === selectedIdx, color: difficultyColor(r?.difficulty_rating || r?.difficulty) };
  }).filter(Boolean);

  // Start / end markers for selected route
  const selLatLon  = allParsed[selectedIdx] || [];
  const selScreenPts = selLatLon.map(p => toScreen(p.latitude, p.longitude));

  // Detect out-and-back: start and end within 300 m of each other
  const isOutAndBack = selLatLon.length >= 2
    && haversineM(selLatLon[0], selLatLon[selLatLon.length - 1]) < 300;

  const startPt = selScreenPts[0];
  const endPt   = selScreenPts[selScreenPts.length - 1];
  const selRoute   = routes[selectedIdx];
  const routeColor = difficultyColor(selRoute?.difficulty_rating || selRoute?.difficulty);

  return (
    <View
      ref={mapRef}
      style={{ width: '100%', height, overflow: 'hidden', backgroundColor: '#c8dce8', cursor: staticView ? 'default' : 'grab' }}
      onLayout={e => setVpW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !staticView}
      onResponderGrant={e => {
        if (staticView) return;
        const now = Date.now();
        if (now - lastTapRef.current < 300) { setZoomDelta(d => d + 1); }
        lastTapRef.current = now;

        // Compute reliable local coords: pageX minus the element's page-position.
        // locationX is relative to whichever child DOM element (tile img) received
        // the event, not the map View — so it's wrong whenever a tile is in the way.
        let lx = e.nativeEvent.pageX;
        let ly = e.nativeEvent.pageY;
        if (mapRef.current?.getBoundingClientRect) {
          const rect = mapRef.current.getBoundingClientRect();
          lx = e.nativeEvent.pageX - rect.left - (window.scrollX ?? 0);
          ly = e.nativeEvent.pageY - rect.top  - (window.scrollY ?? 0);
        }

        dragPointIdxRef.current = -1;
        // In draw mode: tight 14 px radius so panning stays easy
        if (drawMode && drawnPoints.length > 0) {
          for (let i = 0; i < drawnPoints.length; i++) {
            const sx = lonToWorld(drawnPoints[i].lon, zoom) - vpX;
            const sy = latToWorld(drawnPoints[i].lat, zoom) - vpY;
            if (Math.sqrt((lx - sx) ** 2 + (ly - sy) ** 2) < 14) {
              dragPointIdxRef.current = i;
              break;
            }
          }
        }
        dragStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, lx, ly, panX: panOffset.current.x, panY: panOffset.current.y };
      }}
      onResponderMove={e => {
        if (!dragStart.current) return;
        const dx = e.nativeEvent.pageX - dragStart.current.x;
        const dy = e.nativeEvent.pageY - dragStart.current.y;
        if (dragPointIdxRef.current >= 0 && drawMode) {
          // Dragging an existing waypoint — show live preview
          setDragPreview({ idx: dragPointIdxRef.current, lx: dragStart.current.lx + dx, ly: dragStart.current.ly + dy });
          return;
        }
        // Normal map pan
        panOffset.current = { x: dragStart.current.panX + dx, y: dragStart.current.panY + dy };
        setPanState({ x: panOffset.current.x, y: panOffset.current.y });
      }}
      onResponderRelease={e => {
        const totalDx = dragStart.current ? e.nativeEvent.pageX - dragStart.current.x : 0;
        const totalDy = dragStart.current ? e.nativeEvent.pageY - dragStart.current.y : 0;
        const totalDist = Math.sqrt(totalDx ** 2 + totalDy ** 2);

        if (dragPointIdxRef.current >= 0 && drawMode && onMovePoint && dragStart.current) {
          // Commit moved waypoint
          const lx = dragStart.current.lx + totalDx;
          const ly = dragStart.current.ly + totalDy;
          onMovePoint(dragPointIdxRef.current, worldToLatLon(lx + vpX, ly + vpY, zoom));
          dragPointIdxRef.current = -1;
          setDragPreview(null);
          dragStart.current = null;
          return;
        }
        dragPointIdxRef.current = -1;
        // Short tap anywhere (not near existing point) → add new waypoint
        if (dragStart.current && drawMode && onAddPoint && totalDist < 8) {
          onAddPoint(worldToLatLon(dragStart.current.lx + vpX, dragStart.current.ly + vpY, zoom));
        }
        dragStart.current = null;
      }}
    >
      {/* Tile images */}
      {tiles.map(({ key, tileX, ty, left, top }) => (
        <Image
          key={key}
          source={{ uri: tileUrl(zoom, tileX, ty, mapLayer) }}
          style={{ position: 'absolute', left, top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {/* Route + marker SVG overlay */}
      {/* eslint-disable-next-line react-native/no-inline-styles */}
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Unselected routes — start→end connector (or full route in overview mode) */}
        {allParsed.map((pts, i) => {
          if (i === selectedIdx || pts.length < 2) return null;
          const col = difficultyColor(routes[i]?.difficulty_rating || routes[i]?.difficulty);
          const isOverview = selectedIdx === -1;
          if (isOverview) {
            // Overview mode: draw full route with launch dot
            const sp = pts.map(p => toScreen(p.latitude, p.longitude));
            const d  = 'M' + sp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
            const a  = sp[0];
            return (
              <g key={`u${i}`}>
                <path d={d} stroke={col + '88'} strokeWidth={2} fill="none" strokeDasharray="6 3" />
                <circle cx={a.x} cy={a.y} r={5} fill={col} stroke="#fff" strokeWidth={2} />
              </g>
            );
          }
          // One route selected: show ghosted start→end line
          const a = toScreen(pts[0].latitude, pts[0].longitude);
          const b = toScreen(pts[pts.length - 1].latitude, pts[pts.length - 1].longitude);
          return (
            <g key={`u${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col + '55'} strokeWidth={1.5} strokeDasharray="4 4" />
              <circle cx={a.x} cy={a.y} r={4} fill={col + '66'} stroke="#fff" strokeWidth={1.5} />
            </g>
          );
        })}

        {/* Selected route — markers (or plain polyline for drawn/simple routes) */}
        {(() => {
          const pts = allParsed[selectedIdx] || [];
          if (pts.length === 0) return null;
          const col = routeColor;
          const isDrawn = routes[selectedIdx]?.isDrawn === true;

          // Simple mode or hand-drawn: plain polyline + start/end dots only
          if (simpleRoute || isDrawn) {
            const sp = pts.map(p => toScreen(p.latitude, p.longitude));
            const d  = 'M' + sp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
            const a  = sp[0], b = sp[sp.length - 1];
            return (
              <g>
                <path d={d} stroke={col} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={a.x} cy={a.y} r={6} fill={col} stroke="#fff" strokeWidth={2} />
                <circle cx={b.x} cy={b.y} r={6} fill={col} stroke="#fff" strokeWidth={2} />
              </g>
            );
          }

          const kps = extractCriticalPoints(pts);
          if (kps.length === 0) return null;
          const isLoop = kps.length >= 2 && haversineM(kps[0], kps[kps.length - 1]) < 300;

          const LAUNCH_COL = '#16a34a';
          const FINISH_COL = '#dc2626';
          const TURN_COL   = '#2563eb';
          const F          = 'Inter, -apple-system, sans-serif';

          return (
            <g>
              {/* Segment lines + distance labels */}
              {kps.slice(1).map((kp, i) => {
                const a = toScreen(kps[i].latitude, kps[i].longitude);
                const b = toScreen(kp.latitude, kp.longitude);
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const distKm = haversineM(kps[i], kp) / 1000;
                const lbl = distKm >= 1 ? `${distKm.toFixed(1)} km` : `${Math.round(distKm * 1000)} m`;
                return (
                  <g key={`seg${i}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={2.5} strokeDasharray="6 4" opacity="0.75" />
                    <rect x={mx - 19} y={my - 9} width={38} height={15} rx={3} fill="rgba(255,255,255,0.9)" />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize="8" fontWeight="600" fill={col} fontFamily={F}>{lbl}</text>
                  </g>
                );
              })}

              {/* Launch marker — always first point */}
              {(() => {
                const sp = toScreen(kps[0].latitude, kps[0].longitude);
                return (
                  <g key="launch">
                    <circle cx={sp.x} cy={sp.y} r={10} fill={LAUNCH_COL} stroke="#fff" strokeWidth={2.5} />
                    <text x={sp.x} y={sp.y + 4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700" fontFamily={F}>▶</text>
                    <rect x={sp.x - 26} y={sp.y + 14} width={52} height={18} rx={4} fill={LAUNCH_COL} />
                    <text x={sp.x} y={sp.y + 27} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily={F}>LAUNCH</text>
                  </g>
                );
              })()}

              {/* Turn markers — intermediate points */}
              {kps.slice(1, isLoop ? kps.length : kps.length - 1).map((kp, i) => {
                if (isLoop && i === kps.length - 2) return null;
                const sp = toScreen(kp.latitude, kp.longitude);
                const turnN = i + 1;
                return (
                  <g key={`turn${i}`}>
                    <circle cx={sp.x} cy={sp.y} r={8} fill={TURN_COL} stroke="#fff" strokeWidth={2.5} />
                    <text x={sp.x} y={sp.y + 4} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="700" fontFamily={F}>{turnN}</text>
                    <rect x={sp.x - 20} y={sp.y + 12} width={40} height={16} rx={3} fill={TURN_COL} />
                    <text x={sp.x} y={sp.y + 24} textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" fontFamily={F}>TURN {turnN}</text>
                  </g>
                );
              })}

              {/* Finish marker — last point (skip if loop, same as launch) */}
              {!isLoop && (() => {
                const sp = toScreen(kps[kps.length - 1].latitude, kps[kps.length - 1].longitude);
                return (
                  <g key="finish">
                    <circle cx={sp.x} cy={sp.y} r={10} fill={FINISH_COL} stroke="#fff" strokeWidth={2.5} />
                    <text x={sp.x} y={sp.y + 4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700" fontFamily={F}>■</text>
                    <rect x={sp.x - 26} y={sp.y + 14} width={52} height={18} rx={4} fill={FINISH_COL} />
                    <text x={sp.x} y={sp.y + 27} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily={F}>FINISH</text>
                  </g>
                );
              })()}
            </g>
          );
        })()}

        {/* Drawn route */}
        {drawnPoints.length >= 1 && (() => {
          const dsp = drawnPoints.map((p, i) => {
            if (dragPreview?.idx === i) return { x: dragPreview.lx, y: dragPreview.ly };
            return toScreen(p.lat, p.lon);
          });
          return (
            <g>
              {dsp.slice(1).map((pt, i) => (
                <line key={`dl${i}`} x1={dsp[i].x} y1={dsp[i].y} x2={pt.x} y2={pt.y}
                  stroke="#1d4ed8" strokeWidth={2.5} strokeLinecap="round" />
              ))}
              {dsp.map((pt, i) => (
                <g key={`dp${i}`}>
                  {/* Larger invisible hit area */}
                  <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" style={{ cursor: drawMode ? 'grab' : 'default' }} />
                  <circle cx={pt.x} cy={pt.y} r={i === 0 ? 9 : 7}
                    fill={i === 0 ? '#1d4ed8' : '#fff'} stroke="#1d4ed8" strokeWidth={2.5}
                    style={{ cursor: drawMode ? 'grab' : 'default' }} />
                </g>
              ))}
            </g>
          );
        })()}

        {/* Live GPS track */}
        {liveTrack.length >= 2 && (() => {
          const lsp = liveTrack.map(p => toScreen(p.lat, p.lon));
          const d   = 'M' + lsp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
          const tip = lsp[lsp.length - 1];
          return (
            <g>
              <path d={d} stroke="#16a34a" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={tip.x} cy={tip.y} r={7} fill="#16a34a" stroke="#fff" strokeWidth={2.5} />
              <circle cx={tip.x} cy={tip.y} r={3} fill="#fff" />
            </g>
          );
        })()}

        {/* Landmark search markers */}
        {landmarks.map((lm, i) => {
          const sp = toScreen(lm.lat, lm.lon);
          const F  = 'Inter, -apple-system, sans-serif';
          const labelW = Math.min(lm.name.length * 5.5 + 12, 160);
          return (
            <g key={`lm${i}`}>
              <circle cx={sp.x} cy={sp.y} r={7} fill={colors.caution} stroke="#fff" strokeWidth={2} />
              <rect x={sp.x - labelW / 2} y={sp.y - 26} width={labelW} height={16} rx={4} fill="rgba(255,255,255,0.94)" />
              <text x={sp.x} y={sp.y - 14} textAnchor="middle" fontSize="9" fontWeight="600" fill={colors.caution} fontFamily={F}>
                {lm.name.length > 24 ? lm.name.slice(0, 22) + '…' : lm.name}
              </text>
            </g>
          );
        })}

      </svg>

      {/* Right-side controls — layer toggle above zoom */}
      <View style={{ position: 'absolute', top: 8, right: 8, gap: 6, alignItems: 'center' }}>
        {/* Layer thumbnail toggle */}
        <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.14)', gap: 0 }}>
          {[{ id: 'map' }, { id: 'satellite' }].map((opt, i) => {
            const active = mapLayer === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => setMapLayer(opt.id)}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderBottomWidth: i === 0 ? 0.5 : 0, borderBottomColor: 'rgba(0,0,0,0.18)', opacity: active ? 1 : 0.55 }}
                activeOpacity={0.8}
              >
                {opt.id === 'map' ? (
                  <svg width="24" height="18" style={{ borderRadius: 3, display: 'block' }}>
                    <rect width="24" height="18" fill="#eceae4"/>
                    <rect width="24" height="7" fill="#bdd4e8"/>
                    <line x1="0" y1="11" x2="24" y2="11" stroke="#cdc8be" strokeWidth="1.5"/>
                    <line x1="12" y1="7" x2="12" y2="18" stroke="#cdc8be" strokeWidth="1.5"/>
                    <rect x="1" y="12" width="4" height="4" rx="1" fill="#c8e4c8"/>
                    {active && <rect width="24" height="18" fill={colors.primary} opacity="0.18" rx="3"/>}
                  </svg>
                ) : (
                  <svg width="24" height="18" style={{ borderRadius: 3, display: 'block' }}>
                    <rect width="24" height="18" fill="#1e3828"/>
                    <rect width="24" height="7" fill="#142a38"/>
                    <rect x="0" y="7" width="14" height="11" fill="#2a5030"/>
                    <rect x="14" y="9" width="10" height="9" fill="#3a6040"/>
                    <rect x="3" y="8" width="7" height="6" fill="#1e3a28"/>
                    {active && <rect width="24" height="18" fill={colors.primary} opacity="0.25" rx="3"/>}
                  </svg>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Zoom controls */}
        {!staticView && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }}>
            <TouchableOpacity onPress={() => setZoomDelta(d => Math.min(d + 1, 18 - autoZoom))}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.1)' }} activeOpacity={0.7}>
              <Text style={{ fontSize: 18, color: colors.text, lineHeight: 20 }}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setZoomDelta(d => Math.max(d - 1, 1 - autoZoom))}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.1)' }} activeOpacity={0.7}>
              <Text style={{ fontSize: 18, color: colors.text, lineHeight: 20 }}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setZoomDelta(0); panOffset.current = { x: 0, y: 0 }; setPanState({ x: 0, y: 0 }); }}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, color: colors.primary, lineHeight: 15 }}>⊙</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Map attribution */}
      <View style={{ position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
        <Text style={{ fontSize: 7, color: '#555' }}>
          {mapLayer === 'satellite' ? '© Esri  © OpenStreetMap' : MAPBOX_TOKEN ? '© Mapbox  © OpenStreetMap' : '© OpenStreetMap contributors'}
        </Text>
      </View>

      {/* Landmark search — top-left */}
      {!staticView && searchVisible ? (
        <View style={{ position: 'absolute', top: 8, left: 8, right: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', paddingHorizontal: 8, height: 34 }}>
          <TextInput
            style={{ flex: 1, fontSize: 12, color: colors.text, paddingVertical: 0, outlineStyle: 'none' }}
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
            : <TouchableOpacity onPress={handleSearch} style={{ paddingHorizontal: 8, paddingVertical: 4 }} activeOpacity={0.7}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.primary }}>Go</Text>
              </TouchableOpacity>
          }
          <TouchableOpacity onPress={() => { setSearchVisible(false); setSearchQuery(''); setLandmarks([]); }} style={{ paddingHorizontal: 6 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : !staticView ? (
        <TouchableOpacity
          style={{ position: 'absolute', top: 8, left: 8, width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.93)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }}
          onPress={() => setSearchVisible(true)}
          activeOpacity={0.75}
        >
          <Text style={{ fontSize: 17, color: colors.primary }}>⌕</Text>
        </TouchableOpacity>
      ) : null}

      {/* Title overlay */}
      {(overlayTitle || overlayMeta) && (
        <View style={{ position: 'absolute', bottom: 12, left: 12, right: 60, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          {overlayTitle ? <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>{overlayTitle}</Text> : null}
          {overlayMeta  ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>{overlayMeta}</Text> : null}
        </View>
      )}

      {/* Wind + Tide compact strip — full width, bottom of map */}
      {windHourly.length > 0 && (() => {
        const stripDate = activeWindDate ?? windDates[0];
        if (!stripDate) return null;
        const entries = windHourly
          .filter(h => h.time?.startsWith(stripDate))
          .filter(h => { const hr = parseInt(h.time.slice(11, 13) ?? '99', 10); return hr >= 5 && hr <= 21; })
          .sort((a, b) => a.time.localeCompare(b.time));
        if (entries.length === 0) return null;

        const hasTides   = Object.keys(tideHeightMap).length > 0;
        const WIND_MAX   = 26;
        const TIDE_H     = hasTides ? 14 : 0;
        const TIDE_LBL_H = hasTides ? 18 : 0;
        const LABEL_H    = 9;
        const PAD_TOP    = 5;
        const PAD_BOT    = 3;
        const GAP        = hasTides ? 3 : 0;
        const STRIP_H    = PAD_TOP + WIND_MAX + GAP + TIDE_H + (hasTides ? 2 : 0) + TIDE_LBL_H + 2 + LABEL_H + PAD_BOT;
        const WIND_BASE  = PAD_TOP + WIND_MAX;
        const TIDE_TOP   = WIND_BASE + GAP;
        const TIDE_BOT   = TIDE_TOP + TIDE_H;
        const TIDE_LBL_Y = TIDE_BOT + 2 + TIDE_LBL_H - 1;
        const LABEL_Y    = TIDE_LBL_Y + 2 + LABEL_H - 1;

        const n     = entries.length;
        const stripW = vpW - 16;
        const colW   = stripW / n;
        const toX    = i => i * colW + colW / 2;

        const maxSpd = Math.max(...entries.map(h => h.windSpeed ?? 0), 1);

        // Tide sparkline
        const tideHeights = entries.map(h => {
          if (!hasTides) return null;
          return tideHeightMap[h.time.slice(0, 13) + ':00'] ?? null;
        });
        const validT   = tideHeights.filter(t => t !== null);
        const minTide  = validT.length ? Math.min(...validT) : 0;
        const maxTide  = validT.length ? Math.max(...validT) : 1;
        const tideRange = Math.max(maxTide - minTide, 0.01);
        const toTY = h => TIDE_TOP + ((maxTide - h) / tideRange) * TIDE_H;

        let tideLine = '', tideArea = '';
        if (hasTides && validT.length >= 2) {
          const pts = tideHeights.map((h, i) => h != null ? { x: toX(i), y: toTY(h) } : null).filter(Boolean);
          tideLine = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
          for (let i = 1; i < pts.length; i++) {
            const cx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
            tideLine += ` C ${cx} ${pts[i - 1].y.toFixed(1)}, ${cx} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
          }
          tideArea = `${tideLine} L ${pts[pts.length - 1].x.toFixed(1)} ${TIDE_BOT} L ${pts[0].x.toFixed(1)} ${TIDE_BOT} Z`;
        }

        return (
          <View
            style={{ position: 'absolute', bottom: 8, left: 8, right: 8, height: STRIP_H, backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 8, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.1)' }}
            onStartShouldSetResponder={() => true}
            onResponderRelease={e => {
              const rect = e.currentTarget?.getBoundingClientRect?.();
              if (!rect) return;
              const lx = e.nativeEvent.pageX - rect.left;
              const i  = Math.max(0, Math.min(n - 1, Math.floor(lx / colW)));
              setWindHour(parseInt(entries[i].time.slice(11, 13), 10));
            }}
          >
            <svg
              width={stripW} height={STRIP_H}
              style={{ display: 'block' }}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Selected hour highlight */}
              {entries.map((h, i) => {
                const hr = parseInt(h.time.slice(11, 13), 10);
                if (hr !== windHour) return null;
                return <rect key={i} x={i * colW} y={0} width={colW} height={STRIP_H} fill="rgba(37,99,235,0.09)" />;
              })}

              {/* Wind bars */}
              {entries.map((h, i) => {
                const spd  = h.windSpeed ?? 0;
                const barH = Math.max(2, Math.round((spd / maxSpd) * WIND_MAX));
                const col  = spd > 20 ? '#dc2626' : spd > 12 ? '#d97706' : '#2563eb';
                const bw   = Math.max(5, colW * 0.42);
                const x    = toX(i);
                const rotateDeg = h.windDir != null ? (h.windDir + 180) % 360 : null;
                const spdRound = Math.round(spd);
                return (
                  <g key={i}>
                    <rect x={x - bw / 2} y={WIND_BASE - barH} width={bw} height={barH} fill={col + 'cc'} rx={1.5} />
                    {/* Wind direction arrow above bar */}
                    {rotateDeg != null && barH >= 5 && (
                      <text x={x} y={WIND_BASE - barH - 2}
                        textAnchor="middle" fontSize="7" fill={col} fontFamily="system-ui,sans-serif"
                        transform={`rotate(${rotateDeg},${x},${WIND_BASE - barH - 4})`}
                      >↑</text>
                    )}
                    {/* Knot value on bar (when bar tall enough), or just above if small */}
                    {spdRound > 0 && barH >= 8 && (
                      <text x={x} y={WIND_BASE - 2} textAnchor="middle" fontSize="5.5"
                        fill="#fff" fontWeight="600" fontFamily="system-ui,sans-serif">{spdRound}</text>
                    )}
                    {spdRound > 0 && barH < 8 && barH >= 3 && (
                      <text x={x} y={WIND_BASE - barH - 1} textAnchor="middle" fontSize="5.5"
                        fill={col} fontWeight="600" fontFamily="system-ui,sans-serif">{spdRound}</text>
                    )}
                  </g>
                );
              })}

              {/* Separator */}
              {hasTides && <line x1={0} y1={WIND_BASE + GAP / 2} x2={stripW} y2={WIND_BASE + GAP / 2} stroke="rgba(0,0,0,0.07)" strokeWidth={0.5} />}

              {/* Tide area + line */}
              {tideArea && <path d={tideArea} fill="rgba(37,99,235,0.08)" />}
              {tideLine  && <path d={tideLine} stroke="#2563eb" strokeWidth={1.2} fill="none" strokeLinecap="round" />}

              {/* HW / LW dots + exact time + height labels below sparkline */}
              {hasTides && entries.map((h, i) => {
                const ext = tideExtremeMap[h.time.slice(0, 13) + ':00'];
                const ht  = tideHeights[i];
                if (!ext || ht == null) return null;
                const cx = toX(i);
                const cy = toTY(ht);
                return (
                  <g key={i}>
                    <circle cx={cx} cy={cy} r={2.5} fill="#2563eb" stroke="#fff" strokeWidth={0.8} />
                    {/* Exact turn time */}
                    <text x={cx} y={TIDE_BOT + 8} textAnchor="middle" fontSize={6} fontWeight="600"
                      fill="#2563eb" fontFamily="system-ui,sans-serif">{ext.exactTime}</text>
                    {/* Height */}
                    <text x={cx} y={TIDE_BOT + 16} textAnchor="middle" fontSize={5.5} fontWeight="400"
                      fill="#2563eb" fontFamily="system-ui,sans-serif">{ht.toFixed(1)}m</text>
                  </g>
                );
              })}

              {/* Hour labels */}
              {entries.map((h, i) => {
                const hr = parseInt(h.time.slice(11, 13), 10);
                if (![6, 9, 12, 15, 18].includes(hr)) return null;
                const lbl = hr < 12 ? `${hr}am` : hr === 12 ? '12p' : `${hr - 12}pm`;
                return (
                  <text key={i} x={toX(i)} y={LABEL_Y} textAnchor="middle" fontSize={7}
                    fill="rgba(0,0,0,0.38)" fontFamily="system-ui,sans-serif">{lbl}</text>
                );
              })}

              {/* Selected-hour wind speed + tide label (top-left) */}
              {(() => {
                const selEntry = entries.find(h => parseInt(h.time.slice(11, 13), 10) === windHour);
                if (!selEntry) return null;
                const spd = Math.round(selEntry.windSpeed ?? 0);
                const wCol = spd > 20 ? '#dc2626' : spd > 12 ? '#d97706' : '#2563eb';
                const selIdx = entries.indexOf(selEntry);
                const tideHt = hasTides ? (tideHeights[selIdx]) : null;
                const selHr  = windHour < 12 ? `${windHour}am` : windHour === 12 ? '12pm' : `${windHour - 12}pm`;
                const label  = tideHt != null ? `${selHr} · ${spd}kt · ${tideHt.toFixed(1)}m` : `${selHr} · ${spd}kt`;
                return (
                  <text x={5} y={PAD_TOP + 7} fontSize={7.5} fontWeight="600"
                    fill={wCol} fontFamily="system-ui,sans-serif">{label}</text>
                );
              })()}
            </svg>
          </View>
        );
      })()}
    </View>
  );
}
