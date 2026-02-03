/**
 * Dashboard Renderer - Creates 200x200 B&W bitmap for E-ink display
 * Combines weather, calendar, and todo data into one elegant image
 */

const sharp = require('sharp');
const path = require('path');

const WIDTH = 200;
const HEIGHT = 200;

// Simple SVG-based rendering for E-ink
function createDashboardSVG(data) {
  const { weather, events, todos, date } = data;

  // Format date
  const now = date || new Date();
  const dayNum = now.getDate();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthName = monthNames[now.getMonth()];
  const dayName = dayNames[now.getDay()];

  // Weather section
  let weatherSection = '';
  if (weather) {
    weatherSection = `
      <text x="150" y="28" font-size="24" font-weight="bold" text-anchor="end">${weather.temp}C</text>
      <text x="150" y="42" font-size="10" text-anchor="end">${weather.main || ''}</text>
    `;
  }

  // Events section
  let eventsSection = '';
  let eventsY = 65;
  if (events && events.length > 0) {
    eventsSection = `<text x="10" y="${eventsY}" font-size="9" font-weight="bold">EVENTS</text>`;
    eventsY += 14;

    events.slice(0, 3).forEach(event => {
      const time = formatEventTime(event.start);
      const title = truncateText(event.summary, 22);
      eventsSection += `<text x="10" y="${eventsY}" font-size="9">${time} ${title}</text>`;
      eventsY += 12;
    });
  } else {
    eventsSection = `<text x="10" y="${eventsY}" font-size="9" fill="#666">No events today</text>`;
    eventsY += 14;
  }

  // Separator line
  const separatorY = eventsY + 5;
  const separator = `<line x1="10" y1="${separatorY}" x2="190" y2="${separatorY}" stroke="#000" stroke-width="0.5"/>`;

  // Todos section
  let todosSection = '';
  let todosY = separatorY + 18;

  if (todos && todos.length > 0) {
    todosSection = `<text x="10" y="${todosY}" font-size="9" font-weight="bold">TO-DO</text>`;
    todosY += 14;

    todos.slice(0, 4).forEach(todo => {
      const checkbox = todo.completed
        ? `<rect x="10" y="${todosY - 7}" width="8" height="8" fill="#000"/>`
        : `<rect x="10" y="${todosY - 7}" width="8" height="8" fill="none" stroke="#000" stroke-width="1"/>`;

      const text = truncateText(todo.text, 24);
      const textStyle = todo.completed ? 'text-decoration="line-through" fill="#666"' : '';

      todosSection += `
        ${checkbox}
        <text x="22" y="${todosY}" font-size="9" ${textStyle}>${text}</text>
      `;
      todosY += 13;
    });
  } else {
    todosSection = `<text x="10" y="${todosY}" font-size="9" fill="#666">No tasks</text>`;
  }

  // Build complete SVG
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: 'Arial', 'Helvetica', sans-serif; fill: #000; }
      </style>

      <!-- Background -->
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>

      <!-- Header with date and weather -->
      <rect x="0" y="0" width="${WIDTH}" height="50" fill="#000"/>
      <text x="10" y="32" font-size="28" font-weight="bold" fill="#fff">${dayNum}</text>
      <text x="50" y="22" font-size="11" fill="#fff">${dayName}</text>
      <text x="50" y="36" font-size="11" fill="#fff">${monthName}</text>

      ${weather ? `
        <text x="190" y="22" font-size="22" font-weight="bold" text-anchor="end" fill="#fff">${weather.temp}C</text>
        <text x="190" y="38" font-size="10" text-anchor="end" fill="#ccc">${weather.main || ''}</text>
      ` : ''}

      <!-- Content area -->
      ${eventsSection}
      ${separator}
      ${todosSection}

      <!-- Footer line -->
      <line x1="0" y1="199" x2="200" y2="199" stroke="#000" stroke-width="1"/>
    </svg>
  `;

  return svg;
}

function formatEventTime(dateString) {
  if (!dateString) return '';

  // All-day event (just date, no time)
  if (dateString.length === 10) {
    return 'All day';
  }

  const date = new Date(dateString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function truncateText(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 2) + '..';
}

async function renderDashboard(data) {
  try {
    const svg = createDashboardSVG(data);

    // Convert SVG to PNG using sharp
    const pngBuffer = await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT)
      .grayscale()
      .png()
      .toBuffer();

    return pngBuffer;
  } catch (error) {
    console.error('Dashboard render error:', error);
    return null;
  }
}

async function renderDashboardBitmap(data) {
  try {
    const svg = createDashboardSVG(data);

    // Convert SVG to raw grayscale pixels
    const { data: pixels } = await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert to 1-bit bitmap (for E-ink)
    const bitmapSize = Math.ceil((WIDTH * HEIGHT) / 8);
    const bitmap = Buffer.alloc(bitmapSize);

    for (let i = 0; i < pixels.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      // Threshold: pixels > 127 are white (1), else black (0)
      if (pixels[i] > 127) {
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }

    return bitmap;
  } catch (error) {
    console.error('Bitmap render error:', error);
    return null;
  }
}

// Create a simple placeholder dashboard when no data is available
async function renderPlaceholderDashboard(deviceId) {
  const data = {
    weather: null,
    events: [],
    todos: [],
    date: new Date()
  };

  return renderDashboardBitmap(data);
}

module.exports = {
  renderDashboard,
  renderDashboardBitmap,
  renderPlaceholderDashboard,
  WIDTH,
  HEIGHT
};
