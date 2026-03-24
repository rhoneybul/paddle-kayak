const express = require('express');
const router  = express.Router();
const { supabase } = require('../lib/supabase');

// ── GPX generator ─────────────────────────────────────────────────────────────

function generateGpx(name, waypoints) {
  const safeName = (name || 'Route')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const trkpts = (waypoints || [])
    .filter(p => Array.isArray(p) && p.length >= 2)
    .map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Paddle App" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/saved-routes
router.get('/', async (req, res, next) => {
  try {
    await supabase.from('profiles').upsert(
      { id: req.user.id, email: req.user.email, skill_level: 'beginner' },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    const { data, error } = await supabase
      .from('saved_routes')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/saved-routes — save a route + upload GPX to storage
router.post('/', async (req, res, next) => {
  try {
    const {
      name, location_name, location_lat, location_lon,
      distance_km, terrain, difficulty, estimated_duration,
      waypoints, highlights, launch_point, travel_from_base,
      travel_time_min, description, route_data,
    } = req.body;

    // ── Upload GPX to Supabase storage (best-effort) ──────────────────────────
    let gpx_url = null;
    if (Array.isArray(waypoints) && waypoints.length > 0) {
      try {
        const gpxContent = generateGpx(name, waypoints);
        const slug       = (name || 'route').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const fileName   = `${req.user.id}/${Date.now()}-${slug}.gpx`;

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('gpx-routes')
          .upload(fileName, Buffer.from(gpxContent, 'utf-8'), {
            contentType: 'application/gpx+xml',
            upsert: false,
          });

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage
            .from('gpx-routes')
            .getPublicUrl(fileName);
          gpx_url = urlData?.publicUrl || null;
        }
      } catch (_) {
        // Storage unavailable — continue without GPX URL
      }
    }

    // ── Ensure profile exists (required by foreign key) ───────────────────────
    await supabase.from('profiles').upsert(
      { id: req.user.id, email: req.user.email, skill_level: 'beginner' },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    // ── Insert into saved_routes table ────────────────────────────────────────
    const { data, error } = await supabase
      .from('saved_routes')
      .insert({
        user_id:            req.user.id,
        name:               name || 'Saved Route',
        location:           location_name || null,
        location_lat,
        location_lon,
        distance_km,
        terrain,
        difficulty,
        estimated_duration,
        waypoints,
        gpx_url,
        highlights,
        launch_point,
        travel_from_base,
        travel_time_min,
        description,
        route_data:         route_data || {},
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// DELETE /api/saved-routes/:id
router.delete('/:id', async (req, res, next) => {
  try {
    // Fetch to get GPX URL for cleanup
    const { data: row } = await supabase
      .from('saved_routes')
      .select('gpx_url')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    const { error } = await supabase
      .from('saved_routes')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    // Best-effort cleanup of GPX file
    if (row?.gpx_url) {
      try {
        const url  = new URL(row.gpx_url);
        const path = decodeURIComponent(url.pathname).split('/gpx-routes/')[1];
        if (path) await supabase.storage.from('gpx-routes').remove([path]);
      } catch (_) {}
    }

    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
