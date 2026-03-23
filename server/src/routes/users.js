const express = require('express');
const router  = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/users/me
router.get('/me', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    // Auto-create profile if first login
    if (!data) {
      const { data: created, error: createErr } = await supabase
        .from('profiles')
        .insert({
          id:          req.user.id,
          email:       req.user.email,
          skill_level: 'beginner',
        })
        .select()
        .single();
      if (createErr) throw createErr;
      return res.json(created);
    }

    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /api/users/me — update profile
router.patch('/me', async (req, res, next) => {
  try {
    const allowed = ['display_name', 'skill_level', 'strava_id', 'preferences', 'home_location_name', 'home_lat', 'home_lon', 'proficiency_data'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
