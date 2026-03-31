const express = require('express');
const router  = express.Router();

// In-memory cache: key → { data, timestamp }
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Supported POI types → Overpass tag queries
const TYPE_MAP = {
  cafe:       '"amenity"="cafe"',
  pub:        '"amenity"="pub"',
  restaurant: '"amenity"="restaurant"',
  campsite:   '"tourism"="camp_site"',
  shop:       ['"shop"="convenience"', '"shop"="supermarket"'],
  water_tap:  '"amenity"="drinking_water"',
  toilet:     '"amenity"="toilets"',
  parking:    '"amenity"="parking"',
  slipway:    '"leisure"="slipway"',
};

// GET /api/pois?lat=51.5&lon=-0.1&radius=5&types=cafe,pub,campsite
router.get('/', async (req, res, next) => {
  try {
    const { lat, lon, radius = 5, types } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    if (!types)       return res.status(400).json({ error: 'types required (comma-separated)' });

    const typeList = types.split(',').map(t => t.trim()).filter(t => TYPE_MAP[t]);
    if (typeList.length === 0) {
      return res.status(400).json({
        error: 'No valid types provided',
        supported: Object.keys(TYPE_MAP),
      });
    }

    // Check cache
    const cacheKey = `${lat},${lon},${radius},${typeList.sort().join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    const pois = await fetchOverpass(lat, lon, radius, typeList);

    cache.set(cacheKey, { data: pois, timestamp: Date.now() });

    res.json(pois);
  } catch (err) { next(err); }
});

async function fetchOverpass(lat, lon, radiusKm, typeList) {
  const radiusM = radiusKm * 1000;

  // Build Overpass union of node/way queries for each type
  const statements = [];
  for (const type of typeList) {
    const tags = TYPE_MAP[type];
    const tagList = Array.isArray(tags) ? tags : [tags];
    for (const tag of tagList) {
      statements.push(`node[${tag}](around:${radiusM},${lat},${lon});`);
      statements.push(`way[${tag}](around:${radiusM},${lat},${lon});`);
    }
  }

  const query = `
    [out:json][timeout:15];
    (
      ${statements.join('\n      ')}
    );
    out center 30;
  `;

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!resp.ok) return [];
  const json = await resp.json();

  return (json.elements || []).slice(0, 30).map(el => {
    const c = el.center || el;
    return {
      id:   `osm_${el.id}`,
      name: el.tags?.name || null,
      lat:  c.lat,
      lon:  c.lon,
      type: resolveType(el.tags),
      tags: flattenTags(el.tags),
    };
  });
}

// Determine the POI type from OSM tags
function resolveType(tags) {
  if (!tags) return 'unknown';
  if (tags.amenity === 'cafe')            return 'cafe';
  if (tags.amenity === 'pub')             return 'pub';
  if (tags.amenity === 'restaurant')      return 'restaurant';
  if (tags.tourism === 'camp_site')       return 'campsite';
  if (tags.shop === 'convenience' || tags.shop === 'supermarket') return 'shop';
  if (tags.amenity === 'drinking_water')  return 'water_tap';
  if (tags.amenity === 'toilets')         return 'toilet';
  if (tags.amenity === 'parking')         return 'parking';
  if (tags.leisure === 'slipway')         return 'slipway';
  return 'unknown';
}

// Keep only useful OSM tags, drop internal/noisy ones
function flattenTags(tags) {
  if (!tags) return {};
  const keep = [
    'name', 'opening_hours', 'phone', 'website', 'url',
    'cuisine', 'description', 'fee', 'access', 'capacity',
    'drinking_water', 'toilets', 'wheelchair', 'operator',
    'addr:street', 'addr:city', 'addr:postcode',
  ];
  const result = {};
  for (const key of keep) {
    if (tags[key]) result[key] = tags[key];
  }
  return result;
}

module.exports = router;
