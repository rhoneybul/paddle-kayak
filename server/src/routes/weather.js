const express = require('express');
const router  = express.Router();

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

router.get('/', async (req, res, next) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const key   = `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) {
      return res.json({ ...entry.data, cached: true });
    }

    // Fetch forecast + marine in parallel (marine may fail for inland locations)
    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,windspeed_10m,winddirection_10m,weathercode,precipitation` +
      `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,sunrise,sunset,precipitation_sum` +
      `&forecast_days=7&timezone=auto&windspeed_unit=kn`;

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction` +
      `&forecast_days=7&timezone=auto`;

    const [forecastResp, marineResp] = await Promise.allSettled([
      fetch(forecastUrl),
      fetch(marineUrl),
    ]);

    if (forecastResp.status !== 'fulfilled' || !forecastResp.value.ok) {
      throw new Error(`Open-Meteo forecast error: ${forecastResp.reason || forecastResp.value?.status}`);
    }

    const forecastData = await forecastResp.value.json();

    // Marine data is best-effort — inland locations won't have it
    let marineData = null;
    if (marineResp.status === 'fulfilled' && marineResp.value.ok) {
      marineData = await marineResp.value.json();
    }

    // Merge marine hourly into forecast hourly
    if (marineData?.hourly) {
      forecastData.hourly.wave_height       = marineData.hourly.wave_height;
      forecastData.hourly.wave_direction    = marineData.hourly.wave_direction;
      forecastData.hourly.wave_period       = marineData.hourly.wave_period;
      forecastData.hourly.swell_wave_height = marineData.hourly.swell_wave_height;
      forecastData.hourly.swell_wave_direction = marineData.hourly.swell_wave_direction;
    }

    cache.set(key, { data: forecastData, ts: Date.now() });
    res.json({ ...forecastData, cached: false });
  } catch (err) { next(err); }
});

module.exports = router;
