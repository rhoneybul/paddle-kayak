import { getCachedWeather, saveWeatherCache } from './storageService';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchWeather(lat, lon) {
  try {
    const res = await fetch(`${API_URL}/api/weather?lat=${lat}&lon=${lon}`);
    if (res.ok) {
      const raw    = await res.json();
      const parsed = parseWeatherData(raw);
      await saveWeatherCache(lat, lon, parsed);
      return parsed;
    }
  } catch (_) {}

  // Direct fallback — no marine data in this path
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,windspeed_10m,winddirection_10m,weathercode,precipitation` +
    `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,sunrise,sunset,precipitation_sum` +
    `&forecast_days=7&timezone=auto&windspeed_unit=kn`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  const raw    = await res.json();
  const parsed = parseWeatherData(raw);
  await saveWeatherCache(lat, lon, parsed);
  return parsed;
}

export async function getWeatherWithCache(lat, lon) {
  const cached = await getCachedWeather(lat, lon);
  if (cached) return cached;
  return fetchWeather(lat, lon);
}

function parseWeatherData(raw) {
  const { current, hourly, daily } = raw;
  if (!current) throw new Error('Invalid weather response');

  const currentConditions = {
    temp:          Math.round(current.temperature_2m),
    windSpeed:     Math.round(current.windspeed_10m),
    windDir:       current.winddirection_10m,
    windDirLabel:  degreesToCardinal(current.winddirection_10m),
    precipitation: current.precipitation,
    weatherCode:   current.weathercode,
    condition:     wmoToCondition(current.weathercode),
    waveHeight:    0,
    timestamp:     new Date().toISOString(),
  };

  // Build full 7-day hourly forecast
  const hourlyForecast = [];
  const count = hourly?.time?.length ?? 0;
  for (let i = 0; i < count; i++) {
    hourlyForecast.push({
      time:         hourly.time[i],
      temp:         Math.round(hourly.temperature_2m[i]),
      windSpeed:    Math.round(hourly.windspeed_10m[i]),
      windDir:      hourly.winddirection_10m?.[i] ?? null,
      windDirLabel: hourly.winddirection_10m?.[i] != null ? degreesToCardinal(hourly.winddirection_10m[i]) : '—',
      precipProb:   hourly.precipitation_probability[i],
      condition:    wmoToCondition(hourly.weathercode[i]),
      waveHeight:   hourly.wave_height?.[i]            ?? null,
      waveDir:      hourly.wave_direction?.[i]         ?? null,
      wavePeriod:   hourly.wave_period?.[i]            ?? null,
      swellHeight:  hourly.swell_wave_height?.[i]      ?? null,
      swellDir:     hourly.swell_wave_direction?.[i]   ?? null,
    });
  }

  const dailyForecast = (daily?.time || []).map((date, i) => ({
    date,
    condition:     wmoToCondition(daily.weathercode[i]),
    tempMax:       Math.round(daily.temperature_2m_max[i]),
    tempMin:       Math.round(daily.temperature_2m_min[i]),
    windMax:       Math.round(daily.windspeed_10m_max[i]),
    precipitation: Math.round(daily.precipitation_sum?.[i] || 0),
    sunrise:       daily.sunrise[i],
    sunset:        daily.sunset[i],
  }));

  const safetyScore = calcSafetyScore(currentConditions);
  const bestHour    = hourlyForecast.find(h => h.windSpeed <= 15 && h.precipProb <= 30);

  return {
    current:          currentConditions,
    hourly:           hourlyForecast,
    daily:            dailyForecast,
    utcOffsetSeconds: raw.utc_offset_seconds ?? 0,
    safetyScore,
    safetyLabel:   safetyScore >= 80 ? 'Excellent' : safetyScore >= 60 ? 'Good' : safetyScore >= 40 ? 'Moderate' : 'Challenging',
    safetyColor:   safetyScore >= 80 ? '#3a6a4a' : safetyScore >= 60 ? '#4a6a8a' : safetyScore >= 40 ? '#8a6a2a' : '#8a4a3a',
    weatherWindow: bestHour
      ? { label: `Best: ${new Date(bestHour.time).getHours()}:00`, color: '#3a6a4a', time: bestHour.time }
      : { label: 'No ideal window today', color: '#8a6a2a' },
    fetchedAt: Date.now(),
  };
}

function calcSafetyScore(c) {
  let score = 100;
  if (c.windSpeed > 25)        score -= 45;
  else if (c.windSpeed > 20)   score -= 30;
  else if (c.windSpeed > 15)   score -= 15;
  else if (c.windSpeed > 10)   score -= 5;
  if (c.waveHeight > 2)        score -= 30;
  else if (c.waveHeight > 1)   score -= 15;
  else if (c.waveHeight > 0.5) score -= 5;
  const sev = c.condition.severity;
  if (sev === 'severe')        score -= 30;
  else if (sev === 'moderate') score -= 15;
  else if (sev === 'light')    score -= 5;
  return Math.max(0, Math.min(100, score));
}

export function degreesToCardinal(deg) {
  if (deg == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Given wind direction (FROM, degrees) and a route bearing (degrees),
 * returns a label: 'headwind' | 'tailwind' | 'port cross' | 'stbd cross' | 'onshore' | 'offshore'
 */
export function windRelativeToRoute(windFrom, routeBearing) {
  if (windFrom == null || routeBearing == null) return null;
  // Convert "FROM" to "TO" direction
  const windTo = (windFrom + 180) % 360;
  // Angle between wind direction and route bearing
  let diff = ((windTo - routeBearing) + 360) % 360;
  if (diff > 180) diff = 360 - diff; // 0..180
  if (diff <= 30)  return 'tailwind';
  if (diff >= 150) return 'headwind';
  // Determine port/starboard
  const side = ((windTo - routeBearing) + 360) % 360 < 180 ? 'stbd' : 'port';
  return `${side} cross`;
}

function wmoToCondition(code) {
  if (code === 0) return { label: 'Clear',         icon: '☀️',  severity: 'none' };
  if (code <= 3)  return { label: 'Partly Cloudy', icon: '⛅',  severity: 'none' };
  if (code <= 9)  return { label: 'Foggy',         icon: '🌫️', severity: 'light' };
  if (code <= 29) return { label: 'Drizzle',       icon: '🌦️', severity: 'light' };
  if (code <= 39) return { label: 'Rain',          icon: '🌧️', severity: 'moderate' };
  if (code <= 59) return { label: 'Drizzle',       icon: '🌦️', severity: 'light' };
  if (code <= 69) return { label: 'Rain',          icon: '🌧️', severity: 'moderate' };
  if (code <= 79) return { label: 'Snow',          icon: '❄️',  severity: 'moderate' };
  if (code <= 84) return { label: 'Rain Showers',  icon: '🌦️', severity: 'moderate' };
  return { label: 'Thunderstorm', icon: '⛈️', severity: 'severe' };
}
