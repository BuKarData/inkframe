/**
 * Dashboard Renderer - Creates 200x200 B&W bitmap for E-ink display
 * Uses pixel-based rendering for reliability without font dependencies
 */

const sharp = require('sharp');

const WIDTH = 200;
const HEIGHT = 200;

// Simple 5x7 pixel font for numbers and basic ASCII
const FONT_5X7 = {
  '0': [0x3E,0x51,0x49,0x45,0x3E],
  '1': [0x00,0x42,0x7F,0x40,0x00],
  '2': [0x42,0x61,0x51,0x49,0x46],
  '3': [0x21,0x41,0x45,0x4B,0x31],
  '4': [0x18,0x14,0x12,0x7F,0x10],
  '5': [0x27,0x45,0x45,0x45,0x39],
  '6': [0x3C,0x4A,0x49,0x49,0x30],
  '7': [0x01,0x71,0x09,0x05,0x03],
  '8': [0x36,0x49,0x49,0x49,0x36],
  '9': [0x06,0x49,0x49,0x29,0x1E],
  'A': [0x7E,0x11,0x11,0x11,0x7E],
  'B': [0x7F,0x49,0x49,0x49,0x36],
  'C': [0x3E,0x41,0x41,0x41,0x22],
  'D': [0x7F,0x41,0x41,0x22,0x1C],
  'E': [0x7F,0x49,0x49,0x49,0x41],
  'F': [0x7F,0x09,0x09,0x09,0x01],
  'G': [0x3E,0x41,0x49,0x49,0x7A],
  'H': [0x7F,0x08,0x08,0x08,0x7F],
  'I': [0x00,0x41,0x7F,0x41,0x00],
  'J': [0x20,0x40,0x41,0x3F,0x01],
  'K': [0x7F,0x08,0x14,0x22,0x41],
  'L': [0x7F,0x40,0x40,0x40,0x40],
  'M': [0x7F,0x02,0x0C,0x02,0x7F],
  'N': [0x7F,0x04,0x08,0x10,0x7F],
  'O': [0x3E,0x41,0x41,0x41,0x3E],
  'P': [0x7F,0x09,0x09,0x09,0x06],
  'Q': [0x3E,0x41,0x51,0x21,0x5E],
  'R': [0x7F,0x09,0x19,0x29,0x46],
  'S': [0x46,0x49,0x49,0x49,0x31],
  'T': [0x01,0x01,0x7F,0x01,0x01],
  'U': [0x3F,0x40,0x40,0x40,0x3F],
  'V': [0x1F,0x20,0x40,0x20,0x1F],
  'W': [0x3F,0x40,0x38,0x40,0x3F],
  'X': [0x63,0x14,0x08,0x14,0x63],
  'Y': [0x07,0x08,0x70,0x08,0x07],
  'Z': [0x61,0x51,0x49,0x45,0x43],
  ' ': [0x00,0x00,0x00,0x00,0x00],
  ':': [0x00,0x36,0x36,0x00,0x00],
  '-': [0x08,0x08,0x08,0x08,0x08],
  '.': [0x00,0x60,0x60,0x00,0x00],
  '/': [0x20,0x10,0x08,0x04,0x02],
  'a': [0x20,0x54,0x54,0x54,0x78],
  'b': [0x7F,0x48,0x44,0x44,0x38],
  'c': [0x38,0x44,0x44,0x44,0x20],
  'd': [0x38,0x44,0x44,0x48,0x7F],
  'e': [0x38,0x54,0x54,0x54,0x18],
  'f': [0x08,0x7E,0x09,0x01,0x02],
  'g': [0x0C,0x52,0x52,0x52,0x3E],
  'h': [0x7F,0x08,0x04,0x04,0x78],
  'i': [0x00,0x44,0x7D,0x40,0x00],
  'j': [0x20,0x40,0x44,0x3D,0x00],
  'k': [0x7F,0x10,0x28,0x44,0x00],
  'l': [0x00,0x41,0x7F,0x40,0x00],
  'm': [0x7C,0x04,0x18,0x04,0x78],
  'n': [0x7C,0x08,0x04,0x04,0x78],
  'o': [0x38,0x44,0x44,0x44,0x38],
  'p': [0x7C,0x14,0x14,0x14,0x08],
  'q': [0x08,0x14,0x14,0x18,0x7C],
  'r': [0x7C,0x08,0x04,0x04,0x08],
  's': [0x48,0x54,0x54,0x54,0x20],
  't': [0x04,0x3F,0x44,0x40,0x20],
  'u': [0x3C,0x40,0x40,0x20,0x7C],
  'v': [0x1C,0x20,0x40,0x20,0x1C],
  'w': [0x3C,0x40,0x30,0x40,0x3C],
  'x': [0x44,0x28,0x10,0x28,0x44],
  'y': [0x0C,0x50,0x50,0x50,0x3C],
  'z': [0x44,0x64,0x54,0x4C,0x44],
};

// Large numbers for date display (10x14 pixels)
const LARGE_NUMS = {
  '0': [
    '  ######  ',
    ' ######## ',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    '###    ###',
    ' ######## ',
    '  ######  '
  ],
  '1': [
    '    ##    ',
    '   ###    ',
    '  ####    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    '    ##    ',
    ' ######## ',
    ' ######## '
  ],
  '2': [
    ' ######## ',
    '##########',
    '##      ##',
    '        ##',
    '       ## ',
    '      ##  ',
    '     ##   ',
    '    ##    ',
    '   ##     ',
    '  ##      ',
    ' ##       ',
    '##        ',
    '##########',
    '##########'
  ],
  '3': [
    ' ######## ',
    '##########',
    '        ##',
    '        ##',
    '       ## ',
    '   #####  ',
    '   #####  ',
    '       ## ',
    '        ##',
    '        ##',
    '        ##',
    '        ##',
    '##########',
    ' ######## '
  ],
  '4': [
    '##     ## ',
    '##     ## ',
    '##     ## ',
    '##     ## ',
    '##     ## ',
    '##########',
    '##########',
    '       ## ',
    '       ## ',
    '       ## ',
    '       ## ',
    '       ## ',
    '       ## ',
    '       ## '
  ],
  '5': [
    '##########',
    '##########',
    '##        ',
    '##        ',
    '##        ',
    '######### ',
    '##########',
    '        ##',
    '        ##',
    '        ##',
    '        ##',
    '        ##',
    '##########',
    '######### '
  ],
  '6': [
    ' ######## ',
    '##########',
    '##        ',
    '##        ',
    '##        ',
    '######### ',
    '##########',
    '##      ##',
    '##      ##',
    '##      ##',
    '##      ##',
    '##      ##',
    '##########',
    ' ######## '
  ],
  '7': [
    '##########',
    '##########',
    '        ##',
    '       ## ',
    '      ##  ',
    '     ##   ',
    '    ##    ',
    '   ##     ',
    '   ##     ',
    '   ##     ',
    '   ##     ',
    '   ##     ',
    '   ##     ',
    '   ##     '
  ],
  '8': [
    ' ######## ',
    '##########',
    '##      ##',
    '##      ##',
    '##      ##',
    ' ######## ',
    ' ######## ',
    '##      ##',
    '##      ##',
    '##      ##',
    '##      ##',
    '##      ##',
    '##########',
    ' ######## '
  ],
  '9': [
    ' ######## ',
    '##########',
    '##      ##',
    '##      ##',
    '##      ##',
    '##########',
    ' #########',
    '        ##',
    '        ##',
    '        ##',
    '        ##',
    '        ##',
    '##########',
    ' ######## '
  ]
};

class PixelBuffer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height).fill(255); // White background
  }

  setPixel(x, y, black = true) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.pixels[y * this.width + x] = black ? 0 : 255;
    }
  }

  fillRect(x, y, w, h, black = true) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        this.setPixel(px, py, black);
      }
    }
  }

  drawHLine(x, y, length, black = true) {
    for (let i = 0; i < length; i++) {
      this.setPixel(x + i, y, black);
    }
  }

  drawVLine(x, y, length, black = true) {
    for (let i = 0; i < length; i++) {
      this.setPixel(x, y + i, black);
    }
  }

  drawRect(x, y, w, h, black = true) {
    this.drawHLine(x, y, w, black);
    this.drawHLine(x, y + h - 1, w, black);
    this.drawVLine(x, y, h, black);
    this.drawVLine(x + w - 1, y, h, black);
  }

  drawChar(x, y, char, scale = 1, black = true) {
    const charData = FONT_5X7[char] || FONT_5X7[' '];
    if (!charData) return 5 * scale;

    for (let col = 0; col < 5; col++) {
      const colData = charData[col];
      for (let row = 0; row < 7; row++) {
        if ((colData >> row) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              this.setPixel(x + col * scale + sx, y + row * scale + sy, black);
            }
          }
        }
      }
    }
    return 6 * scale; // char width + spacing
  }

  drawText(x, y, text, scale = 1, black = true) {
    let curX = x;
    for (const char of text.toUpperCase()) {
      curX += this.drawChar(curX, y, char, scale, black);
    }
    return curX - x;
  }

  drawLargeNumber(x, y, num, black = true) {
    const pattern = LARGE_NUMS[num];
    if (!pattern) return;

    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < pattern[row].length; col++) {
        if (pattern[row][col] === '#') {
          this.setPixel(x + col, y + row, black);
        }
      }
    }
  }

  drawLargeDate(x, y, day, black = true) {
    const dayStr = day.toString().padStart(2, '0');
    this.drawLargeNumber(x, y, dayStr[0], black);
    this.drawLargeNumber(x + 12, y, dayStr[1], black);
  }

  drawCheckbox(x, y, checked = false) {
    this.drawRect(x, y, 8, 8, true);
    if (checked) {
      this.fillRect(x + 2, y + 2, 4, 4, true);
    }
  }

  toBuffer() {
    return Buffer.from(this.pixels);
  }

  toBitmap() {
    const bitmapSize = Math.ceil((this.width * this.height) / 8);
    const bitmap = Buffer.alloc(bitmapSize);

    for (let i = 0; i < this.pixels.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      if (this.pixels[i] > 127) {
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }

    return bitmap;
  }
}

function createDashboard(data) {
  const { weather, events, todos, date } = data;
  const now = date || new Date();

  const buf = new PixelBuffer(WIDTH, HEIGHT);

  // === HEADER (black background) ===
  buf.fillRect(0, 0, WIDTH, 48, true);

  // Date - large number
  const day = now.getDate();
  buf.drawLargeDate(8, 8, day, false); // white on black

  // Day name and month
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  buf.drawText(36, 10, dayNames[now.getDay()], 1, false);
  buf.drawText(36, 22, monthNames[now.getMonth()], 1, false);

  // Weather (if available)
  if (weather && weather.temp !== undefined) {
    const tempStr = `${weather.temp}C`;
    buf.drawText(150, 10, tempStr, 2, false);
    if (weather.main) {
      buf.drawText(150, 30, weather.main.substring(0, 8).toUpperCase(), 1, false);
    }
  }

  // === EVENTS SECTION ===
  let yPos = 56;
  buf.drawText(8, yPos, 'EVENTS', 1, true);
  yPos += 12;

  if (events && events.length > 0) {
    events.slice(0, 3).forEach(event => {
      const time = formatEventTime(event.start);
      const title = truncateText(event.summary || 'Event', 20);
      buf.drawText(8, yPos, `${time} ${title}`, 1, true);
      yPos += 10;
    });
  } else {
    buf.drawText(8, yPos, 'NO EVENTS TODAY', 1, true);
    yPos += 10;
  }

  // Separator line
  yPos += 4;
  buf.drawHLine(8, yPos, 184, true);
  yPos += 8;

  // === TODOS SECTION ===
  buf.drawText(8, yPos, 'TO-DO', 1, true);
  yPos += 12;

  if (todos && todos.length > 0) {
    todos.slice(0, 4).forEach(todo => {
      buf.drawCheckbox(8, yPos - 6, todo.completed);
      const text = truncateText(todo.text || '', 22);
      buf.drawText(20, yPos, text, 1, true);
      yPos += 11;
    });
  } else {
    buf.drawText(8, yPos, 'NO TASKS', 1, true);
  }

  // Footer line
  buf.drawHLine(0, 198, 200, true);

  return buf;
}

function formatEventTime(dateString) {
  if (!dateString) return '    ';
  if (dateString.length === 10) return 'ALL ';

  const date = new Date(dateString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function truncateText(text, maxLen) {
  if (!text) return '';
  text = text.replace(/[^A-Za-z0-9 :\-./]/g, ''); // Remove unsupported chars
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 2) + '..';
}

async function renderDashboard(data) {
  try {
    const buf = createDashboard(data);

    const pngBuffer = await sharp(buf.toBuffer(), {
      raw: { width: WIDTH, height: HEIGHT, channels: 1 }
    }).png().toBuffer();

    return pngBuffer;
  } catch (error) {
    console.error('Dashboard render error:', error);
    return null;
  }
}

async function renderDashboardBitmap(data) {
  try {
    const buf = createDashboard(data);
    return buf.toBitmap();
  } catch (error) {
    console.error('Bitmap render error:', error);
    return null;
  }
}

async function renderPlaceholderDashboard(deviceId) {
  return renderDashboardBitmap({
    weather: null,
    events: [],
    todos: [],
    date: new Date()
  });
}

module.exports = {
  renderDashboard,
  renderDashboardBitmap,
  renderPlaceholderDashboard,
  WIDTH,
  HEIGHT
};
