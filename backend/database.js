/**
 * Database abstraction layer for InkFrame
 * Uses PostgreSQL when DATABASE_URL is set (Railway), otherwise falls back to JSON files
 */

const { Pool } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// Determine data directory
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// Ensure data directory exists for JSON fallback
if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

// PostgreSQL pool (initialized if DATABASE_URL exists)
let pool = null;
let usePostgres = false;

/**
 * Initialize database connection
 */
async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_URL;

  console.log('=== Database Initialization ===');
  console.log(`DATABASE_URL exists: ${!!process.env.DATABASE_URL}`);
  console.log(`DATABASE_PUBLIC_URL exists: ${!!process.env.DATABASE_PUBLIC_URL}`);
  console.log(`POSTGRES_URL exists: ${!!process.env.POSTGRES_URL}`);

  if (dbUrl) {
    try {
      console.log(`Connecting to PostgreSQL...`);

      pool = new Pool({
        connectionString: dbUrl,
        ssl: {
          rejectUnauthorized: false
        }
      });

      // Test connection
      const result = await pool.query('SELECT NOW() as time');
      console.log(`PostgreSQL connected successfully at ${result.rows[0].time}`);

      // Create tables if they don't exist
      await createTables();
      usePostgres = true;
      console.log('=== Using PostgreSQL for data persistence ===');
      return true;
    } catch (error) {
      console.error('PostgreSQL connection failed:', error.message);
      console.error('Full error:', error);
      pool = null;
      usePostgres = false;
      console.log('=== Falling back to JSON file storage ===');
    }
  } else {
    console.log('No database URL found in environment variables');
    console.log('=== Using JSON file storage (data will NOT persist on Railway!) ===');
  }
  return false;
}

/**
 * Create database tables
 */
async function createTables() {
  const queries = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Devices table - no foreign key to allow device registration before user linking
    `CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT DEFAULT 'My InkFrame',
      current_image TEXT,
      brightness INTEGER DEFAULT 100,
      refresh_version INTEGER DEFAULT 0,
      last_refresh_request TIMESTAMP,
      registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Images table - stores image data directly in PostgreSQL for persistence
    `CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      filename TEXT NOT NULL,
      original_name TEXT,
      image_data BYTEA,
      processed_data BYTEA,
      mime_type TEXT DEFAULT 'image/png',
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Indexes for faster queries
    `CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id)`
  ];

  for (const query of queries) {
    try {
      await pool.query(query);
    } catch (err) {
      console.error(`Table creation error: ${err.message}`);
    }
  }
  console.log('Database tables created/verified');

  // Run migrations for existing tables (add new columns if missing)
  const migrations = [
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS refresh_version INTEGER DEFAULT 0',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_refresh_request TIMESTAMP',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_mode TEXT DEFAULT \'dashboard\'',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_image_index INTEGER DEFAULT 0',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_user_activity TIMESTAMP',
    'ALTER TABLE images ADD COLUMN IF NOT EXISTS image_data BYTEA',
    'ALTER TABLE images ADD COLUMN IF NOT EXISTS processed_data BYTEA',
    'ALTER TABLE images ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT \'image/png\''
  ];

  for (const migration of migrations) {
    try {
      await pool.query(migration);
    } catch (err) {
      // Column might already exist or syntax not supported, ignore
    }
  }
  console.log('Database migrations completed');

  // Log existing data count
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const devicesCount = await pool.query('SELECT COUNT(*) FROM devices');
    const imagesCount = await pool.query('SELECT COUNT(*) FROM images');
    console.log(`Existing data: ${usersCount.rows[0].count} users, ${devicesCount.rows[0].count} devices, ${imagesCount.rows[0].count} images`);
  } catch (err) {
    console.error('Error counting data:', err.message);
  }
}

// ============ USER OPERATIONS ============

async function getUsers() {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM users');
    const users = {};
    result.rows.forEach(row => {
      users[row.id] = {
        id: row.id,
        email: row.email,
        password: row.password,
        name: row.name,
        createdAt: row.created_at
      };
    });
    return users;
  } else {
    const filePath = path.join(DATA_DIR, 'users.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

async function saveUsers(users) {
  if (usePostgres) {
    // For PostgreSQL, we update individual users, not the whole object
    // This function is mainly for JSON compatibility
    return;
  } else {
    const filePath = path.join(DATA_DIR, 'users.json');
    await fs.writeFile(filePath, JSON.stringify(users, null, 2));
  }
}

async function getUserById(id) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      password: row.password,
      name: row.name,
      createdAt: row.created_at
    };
  } else {
    const users = await getUsers();
    return users[id] || null;
  }
}

async function getUserByEmail(email) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      password: row.password,
      name: row.name,
      createdAt: row.created_at
    };
  } else {
    const users = await getUsers();
    return Object.values(users).find(u => u.email === email) || null;
  }
}

async function createUser(user) {
  if (usePostgres) {
    await pool.query(
      'INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)',
      [user.id, user.email, user.password, user.name || null]
    );
  } else {
    const users = await getUsers();
    users[user.id] = user;
    await saveUsers(users);
  }
  return user;
}

// ============ DEVICE OPERATIONS ============

async function getDevices() {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM devices');
    const devices = {};
    result.rows.forEach(row => {
      devices[row.id] = {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        currentImage: row.current_image,
        brightness: row.brightness,
        refreshVersion: row.refresh_version || 0,
        lastRefreshRequest: row.last_refresh_request,
        registeredAt: row.registered_at,
        lastSeen: row.last_seen,
        displayMode: row.display_mode || 'dashboard',
        currentImageIndex: row.current_image_index || 0,
        lastUserActivity: row.last_user_activity
      };
    });
    return devices;
  } else {
    const filePath = path.join(DATA_DIR, 'devices.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

async function saveDevices(devices) {
  if (usePostgres) {
    return;
  } else {
    const filePath = path.join(DATA_DIR, 'devices.json');
    await fs.writeFile(filePath, JSON.stringify(devices, null, 2));
  }
}

async function getDeviceById(id) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM devices WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      currentImage: row.current_image,
      brightness: row.brightness,
      refreshVersion: row.refresh_version || 0,
      lastRefreshRequest: row.last_refresh_request,
      registeredAt: row.registered_at,
      lastSeen: row.last_seen,
      displayMode: row.display_mode || 'dashboard',
      currentImageIndex: row.current_image_index || 0,
      lastUserActivity: row.last_user_activity
    };
  } else {
    const devices = await getDevices();
    return devices[id] || null;
  }
}

async function getDevicesByUserId(userId) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM devices WHERE user_id = $1', [userId]);
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      currentImage: row.current_image,
      brightness: row.brightness,
      refreshVersion: row.refresh_version || 0,
      lastRefreshRequest: row.last_refresh_request,
      registeredAt: row.registered_at,
      lastSeen: row.last_seen,
      displayMode: row.display_mode || 'dashboard',
      currentImageIndex: row.current_image_index || 0,
      lastUserActivity: row.last_user_activity
    }));
  } else {
    const devices = await getDevices();
    return Object.values(devices).filter(d => d.userId === userId);
  }
}

async function createDevice(device) {
  if (usePostgres) {
    await pool.query(
      'INSERT INTO devices (id, user_id, name, current_image, brightness) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET user_id = $2, name = $3',
      [device.id, device.userId || null, device.name || 'My InkFrame', device.currentImage || null, device.brightness || 100]
    );
  } else {
    const devices = await getDevices();
    devices[device.id] = device;
    await saveDevices(devices);
  }
  return device;
}

async function updateDevice(id, updates) {
  if (usePostgres) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (updates.userId !== undefined) {
      setClauses.push(`user_id = $${paramIndex++}`);
      values.push(updates.userId);
    }
    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.currentImage !== undefined) {
      setClauses.push(`current_image = $${paramIndex++}`);
      values.push(updates.currentImage);
    }
    if (updates.brightness !== undefined) {
      setClauses.push(`brightness = $${paramIndex++}`);
      values.push(updates.brightness);
    }
    if (updates.lastSeen !== undefined) {
      setClauses.push(`last_seen = $${paramIndex++}`);
      values.push(updates.lastSeen);
    }
    if (updates.refreshVersion !== undefined) {
      setClauses.push(`refresh_version = $${paramIndex++}`);
      values.push(updates.refreshVersion);
    }
    if (updates.lastRefreshRequest !== undefined) {
      setClauses.push(`last_refresh_request = $${paramIndex++}`);
      values.push(updates.lastRefreshRequest);
    }
    if (updates.displayMode !== undefined) {
      setClauses.push(`display_mode = $${paramIndex++}`);
      values.push(updates.displayMode);
    }
    if (updates.currentImageIndex !== undefined) {
      setClauses.push(`current_image_index = $${paramIndex++}`);
      values.push(updates.currentImageIndex);
    }
    if (updates.lastUserActivity !== undefined) {
      setClauses.push(`last_user_activity = $${paramIndex++}`);
      values.push(updates.lastUserActivity);
    }

    if (setClauses.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE devices SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  } else {
    const devices = await getDevices();
    if (devices[id]) {
      devices[id] = { ...devices[id], ...updates };
      await saveDevices(devices);
    }
  }
}

async function deleteDevice(id) {
  if (usePostgres) {
    await pool.query('DELETE FROM devices WHERE id = $1', [id]);
  } else {
    const devices = await getDevices();
    delete devices[id];
    await saveDevices(devices);
  }
}

// ============ IMAGE OPERATIONS ============

async function getImages() {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM images');
    const images = {};
    result.rows.forEach(row => {
      images[row.id] = {
        id: row.id,
        userId: row.user_id,
        filename: row.filename,
        originalName: row.original_name,
        uploadedAt: row.uploaded_at
      };
    });
    return images;
  } else {
    const filePath = path.join(DATA_DIR, 'images.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

async function saveImages(images) {
  if (usePostgres) {
    return;
  } else {
    const filePath = path.join(DATA_DIR, 'images.json');
    await fs.writeFile(filePath, JSON.stringify(images, null, 2));
  }
}

async function getImagesByUserId(userId) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM images WHERE user_id = $1 ORDER BY uploaded_at DESC', [userId]);
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      filename: row.filename,
      originalName: row.original_name,
      uploadedAt: row.uploaded_at
    }));
  } else {
    const images = await getImages();
    return Object.values(images).filter(i => i.userId === userId);
  }
}

async function createImage(image) {
  if (usePostgres) {
    await pool.query(
      'INSERT INTO images (id, user_id, filename, original_name, image_data, mime_type) VALUES ($1, $2, $3, $4, $5, $6)',
      [image.id, image.userId, image.filename, image.originalName || null, image.imageData || null, image.mimeType || 'image/png']
    );
  } else {
    const images = await getImages();
    images[image.id] = image;
    await saveImages(images);
  }
  return image;
}

async function updateImageData(id, imageData, processedData = null) {
  if (usePostgres) {
    if (processedData) {
      await pool.query(
        'UPDATE images SET image_data = $1, processed_data = $2 WHERE id = $3',
        [imageData, processedData, id]
      );
    } else {
      await pool.query(
        'UPDATE images SET image_data = $1 WHERE id = $2',
        [imageData, id]
      );
    }
  }
}

async function getImageData(id) {
  if (usePostgres) {
    const result = await pool.query('SELECT image_data, processed_data, mime_type FROM images WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return {
      imageData: result.rows[0].image_data,
      processedData: result.rows[0].processed_data,
      mimeType: result.rows[0].mime_type
    };
  }
  return null;
}

async function getImageById(id) {
  if (usePostgres) {
    const result = await pool.query('SELECT * FROM images WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      filename: row.filename,
      originalName: row.original_name,
      uploadedAt: row.uploaded_at
    };
  } else {
    const images = await getImages();
    return images[id] || null;
  }
}

async function deleteImage(id) {
  if (usePostgres) {
    await pool.query('DELETE FROM images WHERE id = $1', [id]);
  } else {
    const images = await getImages();
    delete images[id];
    await saveImages(images);
  }
}

// ============ USER SETTINGS ============

async function getUserSettings(userId) {
  if (usePostgres) {
    try {
      // Create settings table if not exists (with new fields)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id TEXT PRIMARY KEY,
          city TEXT DEFAULT 'Warsaw',
          display_mode TEXT DEFAULT 'dashboard',
          lat REAL,
          lon REAL,
          rotation_interval INTEGER DEFAULT 60,
          lang TEXT DEFAULT 'pl',
          auto_image_mode INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add columns if they don't exist (for migration)
      try {
        await pool.query('ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS rotation_interval INTEGER DEFAULT 60');
        await pool.query('ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT \'pl\'');
        await pool.query('ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_image_mode INTEGER DEFAULT 0');
      } catch (e) { /* columns may already exist */ }

      const result = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        city: row.city,
        displayMode: row.display_mode,
        lat: row.lat,
        lon: row.lon,
        rotationInterval: row.rotation_interval || 60,
        lang: row.lang || 'pl',
        autoImageMode: row.auto_image_mode || 0
      };
    } catch (err) {
      console.error('Get settings error:', err.message);
      return null;
    }
  } else {
    const filePath = path.join(DATA_DIR, 'settings.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const settings = JSON.parse(data);
      return settings[userId] || null;
    } catch {
      return null;
    }
  }
}

async function updateUserSettings(userId, settings) {
  if (usePostgres) {
    try {
      await pool.query(`
        INSERT INTO user_settings (user_id, city, display_mode, lat, lon, rotation_interval, lang, auto_image_mode)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
          city = COALESCE($2, user_settings.city),
          display_mode = COALESCE($3, user_settings.display_mode),
          lat = COALESCE($4, user_settings.lat),
          lon = COALESCE($5, user_settings.lon),
          rotation_interval = COALESCE($6, user_settings.rotation_interval),
          lang = COALESCE($7, user_settings.lang),
          auto_image_mode = COALESCE($8, user_settings.auto_image_mode),
          updated_at = CURRENT_TIMESTAMP
      `, [userId, settings.city, settings.displayMode, settings.lat, settings.lon, settings.rotationInterval, settings.lang, settings.autoImageMode]);
    } catch (err) {
      console.error('Update settings error:', err.message);
    }
  } else {
    const filePath = path.join(DATA_DIR, 'settings.json');
    let data = {};
    try {
      const content = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(content);
    } catch {}

    data[userId] = { ...data[userId], ...settings };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }
}

// ============ UTILITY ============

function isUsingPostgres() {
  return usePostgres;
}

function getPool() {
  return pool;
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
  }
}

module.exports = {
  initDatabase,
  isUsingPostgres,
  closeDatabase,
  getPool,
  // Users
  getUsers,
  saveUsers,
  getUserById,
  getUserByEmail,
  createUser,
  // Devices
  getDevices,
  saveDevices,
  getDeviceById,
  getDevicesByUserId,
  createDevice,
  updateDevice,
  deleteDevice,
  // Images
  getImages,
  saveImages,
  getImagesByUserId,
  createImage,
  getImageById,
  deleteImage,
  updateImageData,
  getImageData,
  // User Settings
  getUserSettings,
  updateUserSettings
};
