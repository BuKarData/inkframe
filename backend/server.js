/**
 * InkFrame API Server
 * 
 * Backend for the InkFrame E-ink Smart Display system.
 * Handles device management, user authentication, and integrations
 * with weather, calendar, and task services.
 * 
 * @author InkFrame Team
 * @version 1.0.0
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const cron = require('node-cron');

// ==================== CONFIGURATION ====================

const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dataDir: process.env.DATA_DIR || './data',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY,
  maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE) || 5 * 1024 * 1024, // 5MB
  corsOrigins: process.env.CORS_ORIGINS || '*',
};

console.log(`Starting InkFrame API in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

// ==================== EXPRESS SETUP ====================

const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS configuration - allow all origins in production for ESP32 devices
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, ESP32, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow all origins
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(morgan(isProduction ? 'combined' : 'dev')); // Logging
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/web', express.static(path.join(__dirname, '..', 'web')));

// ==================== DATA STORAGE ====================
// Simple JSON file storage for development
// Replace with PostgreSQL/MongoDB for production

class DataStore {
  constructor(filename) {
    this.filepath = path.join(config.dataDir, filename);
  }

  async load() {
    try {
      const data = await fs.readFile(this.filepath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async save(data) {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(this.filepath, JSON.stringify(data, null, 2));
  }

  async findById(id) {
    const data = await this.load();
    return data.find(item => item.id === id);
  }

  async findOne(predicate) {
    const data = await this.load();
    return data.find(predicate);
  }

  async findAll(predicate = () => true) {
    const data = await this.load();
    return data.filter(predicate);
  }

  async create(item) {
    const data = await this.load();
    const newItem = { ...item, id: item.id || uuidv4(), createdAt: new Date().toISOString() };
    data.push(newItem);
    await this.save(data);
    return newItem;
  }

  async update(id, updates) {
    const data = await this.load();
    const index = data.findIndex(item => item.id === id);
    if (index === -1) return null;
    data[index] = { ...data[index], ...updates, updatedAt: new Date().toISOString() };
    await this.save(data);
    return data[index];
  }

  async delete(id) {
    const data = await this.load();
    const filtered = data.filter(item => item.id !== id);
    if (filtered.length === data.length) return false;
    await this.save(filtered);
    return true;
  }
}

const users = new DataStore('users.json');
const devices = new DataStore('devices.json');
const images = new DataStore('images.json');
const settings = new DataStore('settings.json');

// ==================== AUTHENTICATION MIDDLEWARE ====================

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    
    const user = await users.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(error);
  }
};

// Optional authentication (for device endpoints that can work without auth)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await users.findById(decoded.userId);
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }
  next();
};

// ==================== FILE UPLOAD ====================

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: config.maxImageSize },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existing = await users.findOne(u => u.email === email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await users.create({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      role: 'user'
    });

    // Generate token
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    next(error);
  }
});

// Login
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await users.findOne(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    next(error);
  }
});

// Get current user
app.get('/api/auth/me', authenticate, (req, res) => {
  const { password, ...user } = req.user;
  res.json({ user });
});

// ==================== DEVICE ROUTES ====================

// Register a new device
app.post('/api/devices/register', async (req, res, next) => {
  try {
    const { deviceId, displayType, firmwareVersion } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    // Check if device exists
    let device = await devices.findOne(d => d.deviceId === deviceId);
    
    if (device) {
      // Update existing device
      device = await devices.update(device.id, {
        displayType,
        firmwareVersion,
        lastSeen: new Date().toISOString()
      });
    } else {
      // Create new device
      device = await devices.create({
        deviceId,
        displayType: displayType || '154_BW',
        firmwareVersion: firmwareVersion || '1.0.0',
        settings: {
          mode: 'image',
          brightness: 100,
          autoRotate: true,
          rotateMinutes: 60,
          timezone: 0
        },
        lastSeen: new Date().toISOString()
      });
    }

    // Generate device API key
    const apiKey = jwt.sign({ deviceId: device.deviceId }, config.jwtSecret);

    res.status(201).json({
      device: {
        id: device.id,
        deviceId: device.deviceId,
        displayType: device.displayType
      },
      apiKey
    });
  } catch (error) {
    next(error);
  }
});

// Link device to user account
app.post('/api/devices/:deviceId/link', authenticate, async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found. Please register it first.' });
    }

    if (device.userId && device.userId !== req.user.id) {
      return res.status(403).json({ error: 'Device is already linked to another account' });
    }

    await devices.update(device.id, { userId: req.user.id });

    res.json({ message: 'Device linked successfully' });
  } catch (error) {
    next(error);
  }
});

// Get user's devices
app.get('/api/devices', authenticate, async (req, res, next) => {
  try {
    const userDevices = await devices.findAll(d => d.userId === req.user.id);
    res.json({ devices: userDevices });
  } catch (error) {
    next(error);
  }
});

// Get device data (weather, calendar, tasks)
app.get('/api/device/:deviceId/data', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Update last seen
    await devices.update(device.id, { lastSeen: new Date().toISOString() });

    // Get all data for the device
    const deviceSettings = device.settings || {};
    
    // Get weather
    const weather = await getWeatherData(deviceSettings.location || 'London');
    
    // Get calendar events (mock for now)
    const calendar = await getCalendarData(device.userId);
    
    // Get tasks (mock for now)
    const tasks = await getTasksData(device.userId);

    res.json({
      weather,
      calendar,
      tasks,
      settings: deviceSettings
    });
  } catch (error) {
    next(error);
  }
});

// Get weather data for device
app.get('/api/device/:deviceId/weather', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await devices.findOne(d => d.deviceId === deviceId);
    
    const location = device?.settings?.location || req.query.location || 'London';
    const weather = await getWeatherData(location);
    
    res.json(weather);
  } catch (error) {
    next(error);
  }
});

// Get calendar data for device
app.get('/api/device/:deviceId/calendar', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await devices.findOne(d => d.deviceId === deviceId);
    
    const calendar = await getCalendarData(device?.userId);
    res.json(calendar);
  } catch (error) {
    next(error);
  }
});

// Get tasks data for device
app.get('/api/device/:deviceId/tasks', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await devices.findOne(d => d.deviceId === deviceId);
    
    const tasks = await getTasksData(device?.userId);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// Update device settings
app.put('/api/device/:deviceId/settings', authenticate, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { settings } = req.body;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updated = await devices.update(device.id, {
      settings: { ...device.settings, ...settings }
    });

    res.json({ settings: updated.settings });
  } catch (error) {
    next(error);
  }
});

// ==================== IMAGE ROUTES ====================

// Display resolutions configuration
const DISPLAY_CONFIGS = {
  '154_BW': { width: 200, height: 200, colors: 2 },
  '154_BWR': { width: 200, height: 200, colors: 3 },
  '213_BW': { width: 250, height: 122, colors: 2 },
  '290_BW': { width: 296, height: 128, colors: 2 },
  '420_BW': { width: 400, height: 300, colors: 2 },
  '750_BW': { width: 800, height: 480, colors: 2 },
  '750_BWR': { width: 800, height: 480, colors: 3 },
  'default': { width: 200, height: 200, colors: 2 }
};

// Floyd-Steinberg dithering for Sharp
async function applyDithering(imageBuffer, width, height, ditherType) {
  if (ditherType === 'none') {
    return imageBuffer;
  }

  // Get raw pixel data
  const { data, info } = await sharp(imageBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);

  if (ditherType === 'floyd') {
    // Floyd-Steinberg dithering
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * info.channels;
        const oldPixel = pixels[i];
        const newPixel = oldPixel < 128 ? 0 : 255;
        const error = oldPixel - newPixel;

        pixels[i] = newPixel;
        if (info.channels > 1) pixels[i + 1] = newPixel;
        if (info.channels > 2) pixels[i + 2] = newPixel;

        // Distribute error to neighboring pixels
        if (x + 1 < width) {
          const idx = i + info.channels;
          pixels[idx] = Math.max(0, Math.min(255, pixels[idx] + error * 7 / 16));
        }
        if (y + 1 < height) {
          if (x > 0) {
            const idx = ((y + 1) * width + x - 1) * info.channels;
            pixels[idx] = Math.max(0, Math.min(255, pixels[idx] + error * 3 / 16));
          }
          const idx = ((y + 1) * width + x) * info.channels;
          pixels[idx] = Math.max(0, Math.min(255, pixels[idx] + error * 5 / 16));
          if (x + 1 < width) {
            const idx = ((y + 1) * width + x + 1) * info.channels;
            pixels[idx] = Math.max(0, Math.min(255, pixels[idx] + error * 1 / 16));
          }
        }
      }
    }
  } else if (ditherType === 'ordered') {
    // Bayer 4x4 ordered dithering
    const matrix = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * info.channels;
        const threshold = (matrix[y % 4][x % 4] + 1) * 16;
        const newPixel = pixels[i] > threshold ? 255 : 0;
        pixels[i] = newPixel;
        if (info.channels > 1) pixels[i + 1] = newPixel;
        if (info.channels > 2) pixels[i + 2] = newPixel;
      }
    }
  }

  // Convert back to PNG
  return await sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: info.channels
    }
  }).png().toBuffer();
}

// Upload image
app.post('/api/images/upload', authenticate, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { deviceId, title, adjustments: adjustmentsStr } = req.body;
    let adjustments = {};

    try {
      if (adjustmentsStr) {
        adjustments = JSON.parse(adjustmentsStr);
      }
    } catch (e) {
      // Ignore parse errors
    }

    // Determine target resolution based on device
    const displayConfig = DISPLAY_CONFIGS[deviceId ?
      (await devices.findOne(d => d.deviceId === deviceId))?.displayType || 'default'
      : 'default'];

    const targetWidth = displayConfig.width;
    const targetHeight = displayConfig.height;

    // Process image
    const filename = `${uuidv4()}.png`;
    const filepath = path.join(config.uploadDir, filename);

    await fs.mkdir(config.uploadDir, { recursive: true });

    // Build Sharp pipeline
    let pipeline = sharp(req.file.buffer)
      .resize(targetWidth, targetHeight, {
        fit: 'cover',
        position: 'center'
      })
      .grayscale();

    // Apply brightness/contrast adjustments if provided
    if (adjustments.brightness || adjustments.contrast) {
      const brightness = (adjustments.brightness || 0) / 100;
      const contrast = 1 + (adjustments.contrast || 0) / 100;
      pipeline = pipeline.modulate({ brightness: 1 + brightness })
        .linear(contrast, -(128 * contrast) + 128);
    }

    // Normalize for better E-ink display
    pipeline = pipeline.normalize();

    // Apply sharpening if requested
    if (adjustments.sharpness && adjustments.sharpness > 0) {
      const sigma = 1 + (adjustments.sharpness / 50);
      pipeline = pipeline.sharpen({ sigma });
    }

    // Get buffer for potential dithering
    let outputBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();

    // Apply dithering if requested
    if (adjustments.dither && adjustments.dither !== 'none') {
      outputBuffer = await applyDithering(outputBuffer, targetWidth, targetHeight, adjustments.dither);
    }

    // Write final file
    await fs.writeFile(filepath, outputBuffer);

    // Save image record with adjustments
    const image = await images.create({
      userId: req.user.id,
      filename,
      title: title || 'Untitled',
      originalName: req.file.originalname,
      mimeType: 'image/png',
      width: targetWidth,
      height: targetHeight,
      deviceId: deviceId || null,
      adjustments: adjustments
    });

    res.status(201).json({
      image: {
        id: image.id,
        url: `/uploads/${filename}`,
        title: image.title,
        width: image.width,
        height: image.height
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user's images
app.get('/api/images', authenticate, async (req, res, next) => {
  try {
    const userImages = await images.findAll(i => i.userId === req.user.id);
    res.json({
      images: userImages.map(i => ({
        id: i.id,
        url: `/uploads/${i.filename}`,
        title: i.title,
        width: i.width,
        height: i.height,
        createdAt: i.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Get image for device
app.get('/api/device/:deviceId/image', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { index = 0 } = req.query;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device || !device.userId) {
      // Return placeholder for unlinked devices
      return res.json({
        url: null,
        message: 'Device not linked to account'
      });
    }

    const userImages = await images.findAll(i => i.userId === device.userId);
    
    if (userImages.length === 0) {
      return res.json({
        url: null,
        message: 'No images uploaded'
      });
    }

    const imageIndex = parseInt(index) % userImages.length;
    const image = userImages[imageIndex];

    res.json({
      url: `/uploads/${image.filename}`,
      title: image.title,
      index: imageIndex,
      total: userImages.length
    });
  } catch (error) {
    next(error);
  }
});

// Get raw bitmap image for ESP32 display
app.get('/api/device/:deviceId/bitmap', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { index = 0 } = req.query;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Update last seen
    await devices.update(device.id, { lastSeen: new Date().toISOString() });

    if (!device.userId) {
      return res.status(404).json({ error: 'Device not linked to account' });
    }

    const userImages = await images.findAll(i => i.userId === device.userId);

    if (userImages.length === 0) {
      return res.status(404).json({ error: 'No images available' });
    }

    const imageIndex = parseInt(index) % userImages.length;
    const image = userImages[imageIndex];

    const imagePath = path.join(config.uploadDir, image.filename);

    try {
      await fs.access(imagePath);
    } catch {
      return res.status(404).json({ error: 'Image file not found' });
    }

    // Get display config
    const displayConfig = DISPLAY_CONFIGS[device.displayType] || DISPLAY_CONFIGS['default'];

    // Convert to raw 1-bit bitmap (packed bytes, MSB first)
    const { data, info } = await sharp(imagePath)
      .resize(displayConfig.width, displayConfig.height, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Pack into 1-bit bitmap (8 pixels per byte)
    const bitmapSize = Math.ceil((displayConfig.width * displayConfig.height) / 8);
    const bitmap = Buffer.alloc(bitmapSize);

    for (let i = 0; i < data.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8); // MSB first
      const isWhite = data[i] > 127;

      if (isWhite) {
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }

    // Send as binary with metadata headers
    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Image-Width': displayConfig.width,
      'X-Image-Height': displayConfig.height,
      'X-Image-Index': imageIndex,
      'X-Image-Total': userImages.length,
      'X-Image-Title': encodeURIComponent(image.title || 'Untitled'),
      'Access-Control-Expose-Headers': 'X-Image-Width, X-Image-Height, X-Image-Index, X-Image-Total, X-Image-Title'
    });

    res.send(bitmap);
  } catch (error) {
    next(error);
  }
});

// Get current image index for device (allows ESP32 to track rotation)
app.get('/api/device/:deviceId/image-info', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device || !device.userId) {
      return res.json({ total: 0, currentIndex: 0 });
    }

    const userImages = await images.findAll(i => i.userId === device.userId);
    const currentIndex = device.currentImageIndex || 0;

    res.json({
      total: userImages.length,
      currentIndex: currentIndex % Math.max(1, userImages.length),
      rotateMinutes: device.settings?.rotateMinutes || 60
    });
  } catch (error) {
    next(error);
  }
});

// Advance to next image (called by ESP32 after displaying)
app.post('/api/device/:deviceId/next-image', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await devices.findOne(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const userImages = await images.findAll(i => i.userId === device.userId);
    const currentIndex = device.currentImageIndex || 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, userImages.length);

    await devices.update(device.id, { currentImageIndex: nextIndex });

    res.json({ nextIndex, total: userImages.length });
  } catch (error) {
    next(error);
  }
});

// Delete image
app.delete('/api/images/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;

    const image = await images.findById(id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    if (image.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete file
    try {
      await fs.unlink(path.join(config.uploadDir, image.filename));
    } catch (e) {
      console.error('Failed to delete file:', e);
    }

    // Delete record
    await images.delete(id);

    res.json({ message: 'Image deleted' });
  } catch (error) {
    next(error);
  }
});

// ==================== INTEGRATION SERVICES ====================

async function getWeatherData(location) {
  // If no API key, return mock data
  if (!config.openWeatherApiKey) {
    return {
      condition: 'Partly Cloudy',
      icon: '02d',
      temperature: 22,
      feels_like: 21,
      humidity: 65,
      wind_speed: 3.5,
      location: location
    };
  }

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: {
          q: location,
          appid: config.openWeatherApiKey,
          units: 'metric'
        }
      }
    );

    const data = response.data;
    return {
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      temperature: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      wind_speed: data.wind.speed,
      location: data.name
    };
  } catch (error) {
    console.error('Weather API error:', error.message);
    return {
      condition: 'Unknown',
      icon: '01d',
      temperature: 0,
      humidity: 0,
      wind_speed: 0,
      location: location,
      error: 'Failed to fetch weather'
    };
  }
}

async function getCalendarData(userId) {
  // Mock calendar data for now
  // In production, integrate with Google Calendar API
  
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  return {
    events: [
      {
        title: 'Team Standup',
        location: 'Zoom',
        start: Math.floor((now + 1 * hour) / 1000),
        end: Math.floor((now + 1.5 * hour) / 1000),
        all_day: false
      },
      {
        title: 'Lunch with Alex',
        location: 'Café Luna',
        start: Math.floor((now + 3 * hour) / 1000),
        end: Math.floor((now + 4 * hour) / 1000),
        all_day: false
      },
      {
        title: 'Project Review',
        location: 'Conference Room B',
        start: Math.floor((now + 5 * hour) / 1000),
        end: Math.floor((now + 6 * hour) / 1000),
        all_day: false
      }
    ]
  };
}

async function getTasksData(userId) {
  // Mock task data for now
  // In production, integrate with Todoist API
  
  return {
    tasks: [
      {
        title: 'Review pull request',
        priority: 1,
        completed: false,
        due: Math.floor(Date.now() / 1000) + 7200
      },
      {
        title: 'Update documentation',
        priority: 2,
        completed: false,
        due: Math.floor(Date.now() / 1000) + 14400
      },
      {
        title: 'Prepare presentation',
        priority: 2,
        completed: false,
        due: Math.floor(Date.now() / 1000) + 86400
      },
      {
        title: 'Send weekly report',
        priority: 3,
        completed: false,
        due: Math.floor(Date.now() / 1000) + 172800
      }
    ]
  };
}

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development',
    port: config.port
  });
});

// Debug endpoint to check registered devices (remove in production if needed)
app.get('/api/debug/devices', async (req, res, next) => {
  try {
    const allDevices = await devices.findAll();
    res.json({
      count: allDevices.length,
      devices: allDevices.map(d => ({
        deviceId: d.deviceId,
        displayType: d.displayType,
        userId: d.userId || 'NOT LINKED',
        lastSeen: d.lastSeen
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Landing page - serve the web app
app.get('/', (req, res) => {
  res.redirect('/web/app.html');
});

// Marketing page
app.get('/landing', (req, res) => {
  res.redirect('/web/index.html');
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);

  if (error.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

// ==================== START SERVER ====================

const PORT = config.port;

// Initialize directories
async function init() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.uploadDir, { recursive: true });
  
  console.log('📁 Data directories initialized');
}

init().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   🖼️  InkFrame API Server                     ║
║                                               ║
║   Server running on port ${PORT}                 ║
║   http://localhost:${PORT}                       ║
║                                               ║
║   Endpoints:                                  ║
║   • POST /api/auth/register                   ║
║   • POST /api/auth/login                      ║
║   • POST /api/devices/register                ║
║   • GET  /api/device/:id/data                 ║
║   • POST /api/images/upload                   ║
║                                               ║
╚═══════════════════════════════════════════════╝
    `);
  });
});

module.exports = app;
