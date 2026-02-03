/**
 * Google Calendar Module - OAuth2 Integration
 */

const { google } = require('googleapis');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://www.eink-luvia.com/api/calendar/callback';

let pool = null;
let usePostgres = false;

function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

async function initCalendarModule(dbPool, isPostgres) {
  pool = dbPool;
  usePostgres = isPostgres;

  if (usePostgres && pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS calendar_tokens (
          user_id TEXT PRIMARY KEY,
          access_token TEXT,
          refresh_token TEXT,
          expiry_date BIGINT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Calendar tokens table initialized');
    } catch (err) {
      console.error('Calendar table creation error:', err.message);
    }
  }
}

function getAuthUrl(userId) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: userId,
    prompt: 'consent'
  });
}

async function handleCallback(code, userId) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return false;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    await saveTokens(userId, tokens);
    return true;
  } catch (error) {
    console.error('Calendar OAuth error:', error.message);
    return false;
  }
}

async function saveTokens(userId, tokens) {
  if (usePostgres && pool) {
    await pool.query(`
      INSERT INTO calendar_tokens (user_id, access_token, refresh_token, expiry_date)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = $2,
        refresh_token = COALESCE($3, calendar_tokens.refresh_token),
        expiry_date = $4,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date]);
  } else {
    const filePath = path.join(DATA_DIR, 'calendar_tokens.json');
    let data = {};
    try {
      const content = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(content);
    } catch {}

    data[userId] = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || data[userId]?.refresh_token,
      expiry_date: tokens.expiry_date
    };

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }
}

async function getTokens(userId) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT * FROM calendar_tokens WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: parseInt(row.expiry_date)
    };
  } else {
    const filePath = path.join(DATA_DIR, 'calendar_tokens.json');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      return data[userId] || null;
    } catch {
      return null;
    }
  }
}

async function getUpcomingEvents(userId, maxResults = 5) {
  const tokens = await getTokens(userId);
  if (!tokens) return null;

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  oauth2Client.setCredentials(tokens);

  // Refresh token if expired
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await saveTokens(userId, credentials);
      oauth2Client.setCredentials(credentials);
    } catch (error) {
      console.error('Token refresh error:', error.message);
      return null;
    }
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return response.data.items.map(event => ({
      id: event.id,
      summary: event.summary || 'No title',
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      allDay: !event.start.dateTime
    }));
  } catch (error) {
    console.error('Calendar API error:', error.message);
    return null;
  }
}

async function isConnected(userId) {
  const tokens = await getTokens(userId);
  return tokens !== null && tokens.refresh_token !== null;
}

async function disconnect(userId) {
  if (usePostgres && pool) {
    await pool.query('DELETE FROM calendar_tokens WHERE user_id = $1', [userId]);
  } else {
    const filePath = path.join(DATA_DIR, 'calendar_tokens.json');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      delete data[userId];
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch {}
  }
}

module.exports = {
  initCalendarModule,
  getAuthUrl,
  handleCallback,
  getUpcomingEvents,
  isConnected,
  disconnect
};
