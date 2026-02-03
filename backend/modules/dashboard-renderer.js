/**
 * Dashboard Renderer - Creates 200x200 B&W bitmap for E-ink display
 * Supports Polish characters and comprehensive text rendering
 */

const sharp = require('sharp');

const WIDTH = 200;
const HEIGHT = 200;

// Extended 5x7 pixel font with Polish characters
const FONT_5X7 = {
  // Numbers
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

  // Uppercase letters
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

  // Lowercase letters
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

  // Polish uppercase
  'Ą': [0x7E,0x11,0x11,0x11,0xFE], // A with ogonek
  'Ć': [0x3E,0x41,0x41,0x45,0x22], // C with acute
  'Ę': [0x7F,0x49,0x49,0x49,0xC1], // E with ogonek
  'Ł': [0x7F,0x48,0x70,0x40,0x40], // L with stroke
  'Ń': [0x7F,0x04,0x0A,0x10,0x7F], // N with acute
  'Ó': [0x3E,0x45,0x41,0x41,0x3E], // O with acute
  'Ś': [0x46,0x49,0x4B,0x49,0x31], // S with acute
  'Ź': [0x61,0x53,0x49,0x45,0x43], // Z with acute
  'Ż': [0x61,0x55,0x49,0x45,0x43], // Z with dot

  // Polish lowercase
  'ą': [0x20,0x54,0x54,0x54,0xF8], // a with ogonek
  'ć': [0x38,0x44,0x46,0x44,0x20], // c with acute
  'ę': [0x38,0x54,0x54,0x54,0x98], // e with ogonek
  'ł': [0x00,0x41,0x7F,0x60,0x00], // l with stroke
  'ń': [0x7C,0x0A,0x04,0x04,0x78], // n with acute
  'ó': [0x38,0x46,0x44,0x44,0x38], // o with acute
  'ś': [0x48,0x54,0x56,0x54,0x20], // s with acute
  'ź': [0x44,0x66,0x54,0x4C,0x44], // z with acute
  'ż': [0x44,0x6C,0x54,0x4C,0x44], // z with dot

  // Symbols
  ' ': [0x00,0x00,0x00,0x00,0x00],
  ':': [0x00,0x36,0x36,0x00,0x00],
  '-': [0x08,0x08,0x08,0x08,0x08],
  '.': [0x00,0x60,0x60,0x00,0x00],
  ',': [0x00,0x80,0x60,0x00,0x00],
  '/': [0x20,0x10,0x08,0x04,0x02],
  '!': [0x00,0x00,0x5F,0x00,0x00],
  '?': [0x02,0x01,0x51,0x09,0x06],
  '(': [0x00,0x1C,0x22,0x41,0x00],
  ')': [0x00,0x41,0x22,0x1C,0x00],
  '+': [0x08,0x08,0x3E,0x08,0x08],
  '=': [0x14,0x14,0x14,0x14,0x14],
  '%': [0x23,0x13,0x08,0x64,0x62],
  '°': [0x00,0x06,0x09,0x06,0x00],
  "'": [0x00,0x00,0x07,0x00,0x00],
  '"': [0x00,0x07,0x00,0x07,0x00],
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

// Polish day names
const DAY_NAMES = {
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  pl: ['NIE', 'PON', 'WTO', 'SRO', 'CZW', 'PIA', 'SOB'],
  de: ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'],
  fr: ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'],
  es: ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB']
};

// Polish month names
const MONTH_NAMES = {
  en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  pl: ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAZ', 'LIS', 'GRU'],
  de: ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'],
  fr: ['JAN', 'FEV', 'MAR', 'AVR', 'MAI', 'JUI', 'JUL', 'AOU', 'SEP', 'OCT', 'NOV', 'DEC'],
  es: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
};

// UI Strings
const UI_STRINGS = {
  en: { events: 'EVENTS', todos: 'TO-DO', noEvents: 'NO EVENTS', noTasks: 'NO TASKS' },
  pl: { events: 'WYDARZENIA', todos: 'ZADANIA', noEvents: 'BRAK WYDARZEN', noTasks: 'BRAK ZADAN' },
  de: { events: 'TERMINE', todos: 'AUFGABEN', noEvents: 'KEINE TERMINE', noTasks: 'KEINE AUFGABEN' },
  fr: { events: 'EVENEMENTS', todos: 'TACHES', noEvents: 'PAS D EVENEMENTS', noTasks: 'PAS DE TACHES' },
  es: { events: 'EVENTOS', todos: 'TAREAS', noEvents: 'SIN EVENTOS', noTasks: 'SIN TAREAS' }
};

class PixelBuffer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height).fill(255); // White background
  }

  setPixel(x, y, black = true) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.pixels[y * this.width + x] = black ? 0 : 255;
    }
  }

  getPixel(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.pixels[y * this.width + x];
    }
    return 255;
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
    const charData = FONT_5X7[char];
    if (!charData) {
      // Unknown character - draw a small box
      if (char !== ' ') {
        for (let i = 0; i < 4 * scale; i++) {
          for (let j = 0; j < 6 * scale; j++) {
            if (i === 0 || i === 3 * scale || j === 0 || j === 5 * scale) {
              this.setPixel(x + i, y + j, black);
            }
          }
        }
      }
      return 6 * scale;
    }

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
    return 6 * scale;
  }

  drawText(x, y, text, scale = 1, black = true) {
    let curX = x;
    for (const char of text) {
      curX += this.drawChar(curX, y, char, scale, black);
    }
    return curX - x;
  }

  // Calculate text width
  measureText(text, scale = 1) {
    return text.length * 6 * scale;
  }

  // Draw text centered horizontally
  drawTextCentered(y, text, scale = 1, black = true) {
    const width = this.measureText(text, scale);
    const x = Math.floor((this.width - width) / 2);
    return this.drawText(x, y, text, scale, black);
  }

  drawLargeNumber(x, y, num, black = true) {
    const pattern = LARGE_NUMS[num];
    if (!pattern) return 0;

    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < pattern[row].length; col++) {
        if (pattern[row][col] === '#') {
          this.setPixel(x + col, y + row, black);
        }
      }
    }
    return 12; // width + spacing
  }

  drawLargeDate(x, y, day, black = true) {
    const dayStr = day.toString().padStart(2, '0');
    let curX = x;
    curX += this.drawLargeNumber(curX, y, dayStr[0], black);
    curX += this.drawLargeNumber(curX, y, dayStr[1], black);
    return curX - x;
  }

  drawCheckbox(x, y, size, checked = false) {
    this.drawRect(x, y, size, size, true);
    if (checked) {
      // Draw checkmark
      const m = Math.floor(size / 2);
      for (let i = 0; i < m; i++) {
        this.setPixel(x + 2 + i, y + m + i, true);
      }
      for (let i = 0; i < m + 2; i++) {
        this.setPixel(x + m + 1 + i, y + size - 3 - i, true);
      }
    }
  }

  // Weather icons (simple pixel art)
  drawWeatherIcon(x, y, condition) {
    const icons = {
      'Clear': () => {
        // Sun
        this.fillRect(x+6, y+6, 8, 8, true);
        for (let i = 0; i < 4; i++) {
          this.drawVLine(x+9, y+i, 3, true);
          this.drawVLine(x+9, y+17, 3, true);
          this.drawHLine(x+i, y+9, 3, true);
          this.drawHLine(x+17, y+9, 3, true);
        }
      },
      'Clouds': () => {
        // Cloud
        this.fillRect(x+4, y+10, 12, 6, true);
        this.fillRect(x+6, y+6, 8, 4, true);
        this.fillRect(x+2, y+12, 4, 4, true);
      },
      'Rain': () => {
        // Cloud with rain
        this.fillRect(x+4, y+6, 12, 5, true);
        this.fillRect(x+6, y+3, 8, 3, true);
        for (let i = 0; i < 3; i++) {
          this.drawVLine(x+5+i*4, y+14, 4, true);
        }
      },
      'Snow': () => {
        // Snowflakes
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 2; j++) {
            this.setPixel(x+4+i*5, y+6+j*8, true);
            this.setPixel(x+6+i*5, y+6+j*8, true);
            this.setPixel(x+5+i*5, y+5+j*8, true);
            this.setPixel(x+5+i*5, y+7+j*8, true);
          }
        }
      }
    };

    const draw = icons[condition] || icons['Clouds'];
    draw();
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
  const { weather, events, todos, date, lang = 'pl' } = data;
  const now = date || new Date();
  const language = DAY_NAMES[lang] ? lang : 'en';

  const buf = new PixelBuffer(WIDTH, HEIGHT);
  const strings = UI_STRINGS[language];
  const dayNames = DAY_NAMES[language];
  const monthNames = MONTH_NAMES[language];

  // === HEADER (black background) ===
  buf.fillRect(0, 0, WIDTH, 52, true);

  // Date - large number
  const day = now.getDate();
  buf.drawLargeDate(8, 6, day, false); // white on black

  // Day name and month
  buf.drawText(36, 8, dayNames[now.getDay()], 1, false);
  buf.drawText(36, 20, monthNames[now.getMonth()], 1, false);
  buf.drawText(36, 32, now.getFullYear().toString(), 1, false);

  // Weather (if available)
  if (weather && weather.temp !== undefined) {
    const tempStr = `${weather.temp}°C`;
    buf.drawText(130, 10, tempStr, 2, false);
    if (weather.main) {
      const weatherText = weather.main.substring(0, 10).toUpperCase();
      buf.drawText(130, 34, weatherText, 1, false);
    }
  } else {
    buf.drawText(140, 20, '--°C', 2, false);
  }

  // === EVENTS SECTION ===
  let yPos = 58;
  buf.drawText(8, yPos, strings.events, 1, true);
  buf.drawHLine(8, yPos + 10, 184, true);
  yPos += 16;

  if (events && events.length > 0) {
    events.slice(0, 3).forEach(event => {
      const time = formatEventTime(event.start);
      const title = truncateText(event.summary || 'Event', 22);
      buf.drawText(8, yPos, `${time} ${title}`, 1, true);
      yPos += 11;
    });
  } else {
    buf.drawText(8, yPos, strings.noEvents, 1, true);
    yPos += 11;
  }

  // === TODOS SECTION ===
  yPos += 6;
  buf.drawText(8, yPos, strings.todos, 1, true);
  buf.drawHLine(8, yPos + 10, 184, true);
  yPos += 16;

  if (todos && todos.length > 0) {
    todos.slice(0, 4).forEach(todo => {
      buf.drawCheckbox(8, yPos - 1, 8, todo.completed);
      const text = truncateText(todo.text || '', 24);
      buf.drawText(20, yPos, text, 1, true);
      yPos += 11;
    });
  } else {
    buf.drawText(8, yPos, strings.noTasks, 1, true);
  }

  // Footer line
  buf.drawHLine(0, 197, 200, true);
  buf.drawHLine(0, 199, 200, true);

  return buf;
}

function formatEventTime(dateString) {
  if (!dateString) return '    ';
  if (dateString.length === 10) return 'CALY'; // All day in Polish

  try {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '    ';
  }
}

function truncateText(text, maxLen) {
  if (!text) return '';
  // Keep Polish characters
  text = text.replace(/[^\w\s\-.:,!?ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüßÄÖÜéèêëàâùûîïôœçÉÈÊËÀÂÙÛÎÏÔŒÇ]/gi, '');
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
    date: new Date(),
    lang: 'pl'
  });
}

module.exports = {
  renderDashboard,
  renderDashboardBitmap,
  renderPlaceholderDashboard,
  PixelBuffer,
  WIDTH,
  HEIGHT
};
