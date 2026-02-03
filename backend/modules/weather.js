/**
 * Weather Module - OpenWeather API Integration
 */

const axios = require('axios');

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const weatherCache = new Map();

async function getWeather(lat, lon, units = 'metric') {
  if (!OPENWEATHER_API_KEY) {
    console.log('OpenWeather API key not configured');
    return null;
  }

  const cacheKey = `${lat},${lon},${units}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        lat,
        lon,
        appid: OPENWEATHER_API_KEY,
        units
      },
      timeout: 10000
    });

    const data = {
      temp: Math.round(response.data.main.temp),
      feels_like: Math.round(response.data.main.feels_like),
      humidity: response.data.main.humidity,
      description: response.data.weather[0].description,
      icon: response.data.weather[0].icon,
      main: response.data.weather[0].main,
      city: response.data.name,
      wind: Math.round(response.data.wind.speed),
      timestamp: Date.now()
    };

    weatherCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error('Weather API error:', error.message);
    return cached?.data || null;
  }
}

async function getWeatherByCity(city, units = 'metric') {
  if (!OPENWEATHER_API_KEY) {
    return null;
  }

  const cacheKey = `city:${city},${units}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        q: city,
        appid: OPENWEATHER_API_KEY,
        units
      },
      timeout: 10000
    });

    const data = {
      temp: Math.round(response.data.main.temp),
      feels_like: Math.round(response.data.main.feels_like),
      humidity: response.data.main.humidity,
      description: response.data.weather[0].description,
      icon: response.data.weather[0].icon,
      main: response.data.weather[0].main,
      city: response.data.name,
      wind: Math.round(response.data.wind.speed),
      timestamp: Date.now()
    };

    weatherCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error('Weather API error:', error.message);
    return cached?.data || null;
  }
}

function getWeatherIcon(iconCode) {
  // Map OpenWeather icons to simple text descriptions for E-ink
  const iconMap = {
    '01d': 'Clear', '01n': 'Clear',
    '02d': 'Few clouds', '02n': 'Few clouds',
    '03d': 'Cloudy', '03n': 'Cloudy',
    '04d': 'Overcast', '04n': 'Overcast',
    '09d': 'Showers', '09n': 'Showers',
    '10d': 'Rain', '10n': 'Rain',
    '11d': 'Thunder', '11n': 'Thunder',
    '13d': 'Snow', '13n': 'Snow',
    '50d': 'Mist', '50n': 'Mist'
  };
  return iconMap[iconCode] || 'Unknown';
}

module.exports = {
  getWeather,
  getWeatherByCity,
  getWeatherIcon
};
