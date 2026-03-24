import { useState } from 'react';
import { View, Text, Image } from 'react-native';
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

// ── Map tile config ───────────────────────────────────────────────────────────

const TILE_SIZE    = 256;
const ROUTE_COLORS = [colors.primary, colors.caution, colors.textMid];
const PAD          = 0.30; // 30 % padding around route bounding box

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
// light-v11 = soft off-white / greyscale premium look
const MAPBOX_STYLE = 'mapbox/light-v11';

function tileUrl(zoom, x, y) {
  if (MAPBOX_TOKEN) {
    return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/256/${zoom}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
  }
  // Fallback to OSM when no token configured
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/** World pixel X for a longitude at a given zoom. */
function lonToWorld(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * (1 << zoom);
}

/** World pixel Y for a latitude at a given zoom (Web Mercator). */
function latToWorld(lat, zoom) {
  const r = lat * Math.PI / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE_SIZE * (1 << zoom);
}

/** Find the highest zoom where the padded bbox fits inside the viewport. */
function calcZoom(bMinLon, bMaxLon, bMinLat, bMaxLat, vpW, vpH) {
  for (let z = 16; z >= 1; z--) {
    const pxW = lonToWorld(bMaxLon, z) - lonToWorld(bMinLon, z);
    const pxH = latToWorld(bMinLat, z) - latToWorld(bMaxLat, z); // lat inverted
    if (pxW <= vpW && pxH <= vpH) return z;
  }
  return 1;
}

// ── Web component ─────────────────────────────────────────────────────────────

export default function PaddleMap({
  height = 240,
  routes = [],
  selectedIdx = 0,
  overlayTitle,
  overlayMeta,
}) {
  const [vpW, setVpW] = useState(390);

  const allParsed = routes.map(r => parseGpx(r.waypoints || []));
  const allPts    = allParsed.flat();

  // No waypoints yet — show a neutral placeholder
  if (allPts.length === 0) {
    return (
      <View style={{ height, backgroundColor: '#c8dce8', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Map will appear here</Text>
      </View>
    );
  }

  // Bounding box + padding
  const lats   = allPts.map(p => p.latitude);
  const lons   = allPts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const dLat   = Math.max(maxLat - minLat, 0.004);
  const dLon   = Math.max(maxLon - minLon, 0.004);
  const bMinLat = minLat - dLat * PAD,  bMaxLat = maxLat + dLat * PAD;
  const bMinLon = minLon - dLon * PAD,  bMaxLon = maxLon + dLon * PAD;

  // Zoom & centre
  const zoom      = calcZoom(bMinLon, bMaxLon, bMinLat, bMaxLat, vpW, height);
  const centerLon = (bMinLon + bMaxLon) / 2;
  const centerLat = (bMinLat + bMaxLat) / 2;
  const cx        = lonToWorld(centerLon, zoom);
  const cy        = latToWorld(centerLat, zoom);

  // Viewport top-left in world pixels
  const vpX = cx - vpW    / 2;
  const vpY = cy - height / 2;

  // Tile grid
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

  // World pixel → screen coords
  const toScreen = (lat, lon) => ({
    x: lonToWorld(lon, zoom) - vpX,
    y: latToWorld(lat, zoom) - vpY,
  });

  // SVG paths for each route
  const svgRoutes = allParsed.map((pts, i) => {
    if (pts.length < 2) return null;
    const sp = pts.map(p => toScreen(p.latitude, p.longitude));
    const d  = 'M' + sp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
    return { d, selected: i === selectedIdx, color: ROUTE_COLORS[i] || ROUTE_COLORS[0] };
  }).filter(Boolean);

  // Start / end markers for selected route
  const selPts = (allParsed[selectedIdx] || []).map(p => toScreen(p.latitude, p.longitude));

  return (
    <View
      style={{ width: '100%', height, overflow: 'hidden', backgroundColor: '#c8dce8' }}
      onLayout={e => setVpW(e.nativeEvent.layout.width)}
    >
      {/* OSM tile images */}
      {tiles.map(({ key, tileX, ty, left, top }) => (
        <Image
          key={key}
          source={{ uri: tileUrl(zoom, tileX, ty) }}
          style={{ position: 'absolute', left, top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {/* Route + marker SVG overlay */}
      {/* eslint-disable-next-line react-native/no-inline-styles */}
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          overflow: 'visible', pointerEvents: 'none',
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Unselected routes — thin, semi-transparent */}
        {svgRoutes.filter(r => !r.selected).map((r, i) => (
          <path key={`u${i}`} d={r.d} stroke={r.color + '88'} strokeWidth={2}
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* Selected route — thick, solid */}
        {svgRoutes.filter(r => r.selected).map((r, i) => (
          <path key={`s${i}`} d={r.d} stroke={r.color} strokeWidth={4}
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* Start marker */}
        {selPts.length >= 2 && (
          <circle cx={selPts[0].x} cy={selPts[0].y} r={6}
            fill={ROUTE_COLORS[selectedIdx] || ROUTE_COLORS[0]} stroke="#fff" strokeWidth={2} />
        )}
        {/* End marker */}
        {selPts.length >= 2 && (
          <circle cx={selPts[selPts.length - 1].x} cy={selPts[selPts.length - 1].y} r={6}
            fill={colors.warn} stroke="#fff" strokeWidth={2} />
        )}
      </svg>

      {/* Map attribution */}
      <View style={{
        position: 'absolute', bottom: 2, right: 2,
        backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 3,
        paddingHorizontal: 4, paddingVertical: 1,
      }}>
        <Text style={{ fontSize: 7, color: '#555' }}>
          {MAPBOX_TOKEN ? '© Mapbox  © OpenStreetMap' : '© OpenStreetMap contributors'}
        </Text>
      </View>

      {/* Title overlay */}
      {(overlayTitle || overlayMeta) && (
        <View style={{
          position: 'absolute', bottom: 12, left: 12, right: 60,
          backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10,
          paddingHorizontal: 12, paddingVertical: 8,
        }}>
          {overlayTitle
            ? <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>{overlayTitle}</Text>
            : null}
          {overlayMeta
            ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>{overlayMeta}</Text>
            : null}
        </View>
      )}
    </View>
  );
}
