/* NEO_SKILL_META
{
  "name": "weather_checker",
  "description": "Retrieve current weather for a location using OpenWeather (if configured) with a resilient simulated fallback.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City and region/country, e.g. 'Pittsburgh, PA'." },
      "units": { "type": "string", "enum": ["metric", "imperial"], "description": "Temperature units (default: metric)." }
    },
    "required": ["location"]
  }
}
NEO_SKILL_META */

import { setTimeout as delay } from 'timers/promises';

type Units = 'metric' | 'imperial';

interface WeatherResult {
  location: string;
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  units: Units;
  source: 'api' | 'simulated';
  note?: string;
}

export async function run(args: { location?: string; units?: Units }) {
  const location = (args.location || '').trim();
  const units: Units = args.units === 'imperial' ? 'imperial' : 'metric';

  if (!location) {
    return "Error: Please provide a location, e.g. 'Pittsburgh, PA'.";
  }

  try {
    const weather = await fetchWeather(location, units);
    return formatWeather(weather);
  } catch (error: any) {
    return `Error checking weather: ${error.message || 'Unknown error occurred'}`;
  }
}

async function fetchWeather(location: string, units: Units): Promise<WeatherResult> {
  const apiKey = process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY;
  const unitParam = units === 'metric' ? 'metric' : 'imperial';

  if (!apiKey) {
    return simulatedWeather(location, units, 'No API key configured; returning simulated data.');
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${unitParam}&appid=${apiKey}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return simulatedWeather(location, units, `API error (${response.status}); returning simulated data.`);
    }
    const data = await response.json();
    if (!data || !data.main || typeof data.main.temp !== 'number') {
      return simulatedWeather(location, units, 'Unexpected API payload; returning simulated data.');
    }

    return {
      location: data.name || location,
      temperature: Math.round(data.main.temp),
      condition: (data.weather && data.weather[0] && data.weather[0].description) || 'Unknown',
      humidity: typeof data.main.humidity === 'number' ? data.main.humidity : 0,
      windSpeed: data.wind && typeof data.wind.speed === 'number' ? data.wind.speed : 0,
      units,
      source: 'api'
    };
  } catch (error: any) {
    return simulatedWeather(location, units, `API request failed: ${error.message}; returning simulated data.`);
  }
}

function simulatedWeather(location: string, units: Units, note?: string): WeatherResult {
  const hash = [...location].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const baseTemp = units === 'metric' ? 15 : 59; // ~59F = 15C
  const temp = baseTemp + ((hash % 10) - 5); // +/-5 swing
  const conditions = ['Clear', 'Partly cloudy', 'Overcast', 'Rain showers', 'Light rain', 'Windy', 'Humid'];
  const condition = conditions[hash % conditions.length];

  return {
    location,
    temperature: temp,
    condition,
    humidity: 50 + (hash % 40),
    windSpeed: 5 + (hash % 15),
    units,
    source: 'simulated',
    note
  };
}

function formatWeather(result: WeatherResult): string {
  const unitLabel = result.units === 'metric' ? 'C' : 'F';
  const windLabel = result.units === 'metric' ? 'km/h' : 'mph';

  const lines = [
    `Weather for ${result.location} (${result.source === 'api' ? 'live' : 'simulated'}):`,
    `- Temperature: ${result.temperature}${unitLabel}`,
    `- Condition: ${capitalize(result.condition)}`,
    `- Humidity: ${result.humidity}%`,
    `- Wind: ${result.windSpeed} ${windLabel}`
  ];

  if (result.note) {
    lines.push(`- Note: ${result.note}`);
  }

  return lines.join('\n');
}

function capitalize(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
