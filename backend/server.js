/**
 * InkFrame API Server
 *
 * Backend for the InkFrame E-ink Smart Display system.
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
const fsSync = require('fs');
const db = require('./database');
const weatherModule = require('./modules/weather');
const todoModule = require('./modules/todo');
const calendarModule = require('./modules/calendar');
const dashboardRenderer = require('./modules/dashboard-renderer');
const imageProcessor = require('./modules/image-processor');

// ==================== CONFIGURATION ====================

const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

// Use absolute paths based on the location of THIS file
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');
const WEB_DIR = path.join(PROJECT_ROOT, 'web');

const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  webDir: WEB_DIR,
  maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE) || 5 * 1024 * 1024,
};

console.log('='.repeat(50));
console.log(`InkFrame API Server - ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log('='.repeat(50));
console.log(`Project Root: ${PROJECT_ROOT}`);
console.log(`Data Dir: ${DATA_DIR}`);
console.log(`Upload Dir: ${UPLOAD_DIR}`);
console.log(`Web Dir: ${WEB_DIR}`);
console.log('='.repeat(50));

// ==================== EXPRESS SETUP ====================

const app = express();

// Security middleware with relaxed CSP for our app
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS - allow all origins for ESP32 devices
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==================== STATIC FILE SERVING ====================

// Serve uploaded images
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '1d',
  etag: true
}));

// Serve web app files
app.use('/web', express.static(WEB_DIR, {
  maxAge: '1h',
  etag: true
}));

// Root route - serve landing page directly (not redirect)
app.get('/', (req, res) => {
  const indexPath = path.join(WEB_DIR, 'index.html');
  if (fsSync.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Landing page not found. Please check deployment.');
  }
});

// App route
app.get('/app', (req, res) => {
  const appPath = path.join(WEB_DIR, 'app.html');
  if (fsSync.existsSync(appPath)) {
    res.sendFile(appPath);
  } else {
    res.status(404).send('App not found. Please check deployment.');
  }
});

// ==================== DATA STORAGE ====================
// Using database module (PostgreSQL in production, JSON files locally)

// ==================== AUTHENTICATION ====================

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await db.getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    if (error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    next(error);
  }
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await db.getUserById(decoded.userId);
    if (user) req.user = user;
  } catch (error) { /* ignore */ }
  next();
};

// ==================== FILE UPLOAD ====================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageSize },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await db.createUser({
      id: uuidv4(),
      email,
      password: hashedPassword,
      name: name || email.split('@')[0]
    });
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const { password, ...user } = req.user;
  res.json({ user });
});

// ==================== DEVICE ROUTES ====================

app.post('/api/devices/register', async (req, res, next) => {
  try {
    const { deviceId, displayType, firmwareVersion } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    console.log(`Device registration request: ${deviceId}`);

    let device = await db.getDeviceById(deviceId);
    if (device) {
      await db.updateDevice(deviceId, {
        lastSeen: new Date().toISOString()
      });
      console.log(`Device updated: ${deviceId}`);
    } else {
      device = await db.createDevice({
        id: deviceId,
        name: 'My InkFrame',
        brightness: 100
      });
      console.log(`New device registered: ${deviceId}`);
    }

    const apiKey = jwt.sign({ deviceId }, config.jwtSecret);
    res.status(201).json({
      device: { id: deviceId, deviceId, displayType: displayType || '154_BW' },
      apiKey
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/devices/:deviceId/link', authenticate, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    console.log(`Link request for device: ${deviceId} by user: ${req.user.id}`);

    const device = await db.getDeviceById(deviceId);
    if (!device) {
      // List all devices for debugging
      const allDevices = await db.getDevices();
      console.log(`Available devices: ${Object.keys(allDevices).join(', ') || 'none'}`);
      return res.status(404).json({
        error: 'Device not found. Make sure your InkFrame is powered on, connected to WiFi, and showing its Device ID on the dashboard screen. The device must connect to the server at least once before you can link it.'
      });
    }

    if (device.userId && device.userId !== req.user.id) {
      return res.status(403).json({ error: 'Device is already linked to another account' });
    }

    await db.updateDevice(deviceId, { userId: req.user.id });
    console.log(`Device ${deviceId} linked to user ${req.user.id}`);
    res.json({ message: 'Device linked successfully' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/devices', authenticate, async (req, res, next) => {
  try {
    const userDevices = await db.getDevicesByUserId(req.user.id);
    res.json({ devices: userDevices });
  } catch (error) {
    next(error);
  }
});

// Trigger device refresh - marks that device should fetch new content
app.post('/api/devices/:deviceId/refresh', authenticate, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { mode } = req.body; // Optional: set display mode on refresh

    const device = await db.getDeviceById(deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Mark device as needing refresh (increment refresh counter)
    const refreshVersion = (device.refreshVersion || 0) + 1;
    const now = new Date().toISOString();

    const updates = {
      refreshVersion,
      lastRefreshRequest: now,
      lastUserActivity: now // User is active when they trigger refresh
    };

    // Optionally set display mode
    if (mode && ['dashboard', 'photo'].includes(mode)) {
      updates.displayMode = mode;
    }

    await db.updateDevice(deviceId, updates);

    console.log(`Device ${deviceId} refresh triggered, version: ${refreshVersion}, mode: ${mode || 'unchanged'}`);
    res.json({ message: 'Device refresh triggered', refreshVersion, displayMode: mode || device.displayMode });
  } catch (error) {
    next(error);
  }
});

// Check if device should refresh (called by ESP32)
app.get('/api/devices/:deviceId/should-refresh', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { currentVersion = 0 } = req.query;

    const device = await db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const serverVersion = device.refreshVersion || 0;
    const shouldRefresh = serverVersion > parseInt(currentVersion);

    res.json({
      shouldRefresh,
      currentVersion: serverVersion
    });
  } catch (error) {
    next(error);
  }
});

// Debug endpoint - list all registered devices
app.get('/api/debug/devices', async (req, res) => {
  const allDevices = await db.getDevices();
  const deviceList = Object.values(allDevices);
  res.json({
    count: deviceList.length,
    devices: deviceList.map(d => ({
      deviceId: d.id,
      userId: d.userId || 'NOT LINKED',
      lastSeen: d.lastSeen
    })),
    storage: db.isUsingPostgres() ? 'PostgreSQL' : 'JSON files'
  });
});

// ==================== IMAGE ROUTES ====================

const DISPLAY_CONFIGS = {
  '154_BW': { width: 200, height: 200 },
  '154_BWR': { width: 200, height: 200 },
  '213_BW': { width: 250, height: 122 },
  '290_BW': { width: 296, height: 128 },
  '420_BW': { width: 400, height: 300 },
  '750_BW': { width: 800, height: 480 },
  'default': { width: 200, height: 200 }
};

app.post('/api/images/upload', authenticate, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`Image upload by user ${req.user.id}: ${req.file.originalname}`);

    const imageId = uuidv4();
    const filename = `${imageId}.png`;

    // Store original image in database for persistence (Railway has ephemeral filesystem)
    const image = await db.createImage({
      id: imageId,
      userId: req.user.id,
      filename,
      originalName: req.file.originalname,
      imageData: req.file.buffer,
      mimeType: req.file.mimetype
    });

    // Also save to filesystem for quick access (will be regenerated from DB if missing)
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const displayConfig = DISPLAY_CONFIGS['default'];
      const processedBuffer = await sharp(req.file.buffer)
        .resize(displayConfig.width, displayConfig.height, { fit: 'cover', position: 'center' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await fs.writeFile(path.join(UPLOAD_DIR, filename), processedBuffer);
    } catch (fsErr) {
      console.log('Filesystem write skipped (ephemeral):', fsErr.message);
    }

    res.status(201).json({
      image: {
        id: image.id,
        url: `/api/images/${image.id}/file`,
        title: image.originalName,
        width: 200,
        height: 200
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    next(error);
  }
});

// Serve image file from database (persistent) or filesystem (cache)
app.get('/api/images/:id/file', async (req, res, next) => {
  try {
    const { id } = req.params;
    const image = await db.getImageById(id);
    if (!image) return res.status(404).json({ error: 'Image not found' });

    // Try filesystem first (faster)
    const filepath = path.join(UPLOAD_DIR, image.filename);
    try {
      await fs.access(filepath);
      return res.sendFile(filepath);
    } catch {
      // Filesystem miss - get from database
    }

    // Get from database
    const imageData = await db.getImageData(id);
    if (!imageData || !imageData.imageData) {
      return res.status(404).json({ error: 'Image data not found' });
    }

    // Regenerate processed image from original
    const displayConfig = DISPLAY_CONFIGS['default'];
    const processedBuffer = await sharp(imageData.imageData)
      .resize(displayConfig.width, displayConfig.height, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    // Cache to filesystem for next time
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.writeFile(filepath, processedBuffer);
    } catch {}

    res.set('Content-Type', 'image/png');
    res.send(processedBuffer);
  } catch (error) {
    next(error);
  }
});

app.get('/api/images', authenticate, async (req, res, next) => {
  try {
    const userImages = await db.getImagesByUserId(req.user.id);
    console.log(`User ${req.user.id} has ${userImages.length} images`);
    res.json({
      images: userImages.map(i => ({
        id: i.id,
        url: `/api/images/${i.id}/file`,
        title: i.originalName || 'Untitled',
        createdAt: i.uploadedAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/images/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const image = await db.getImageById(id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    if (image.userId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    try {
      await fs.unlink(path.join(UPLOAD_DIR, image.filename));
    } catch (e) {
      console.error('Failed to delete file:', e);
    }

    await db.deleteImage(id);
    res.json({ message: 'Image deleted' });
  } catch (error) {
    next(error);
  }
});

// Image preview with processing (for editor)
app.post('/api/images/preview', authenticate, async (req, res, next) => {
  try {
    const { imageId, brightness, contrast, sharpness, gamma, dithering, rotation, flipH, flipV, invert,
            cropX, cropY, cropW, cropH, textOverlay, textPosition, textSize } = req.body;

    if (!imageId) {
      return res.status(400).json({ error: 'Image ID required' });
    }

    const image = await db.getImageById(imageId);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    if (image.userId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    // Try to get image from database first (persistent), then filesystem
    let imageBuffer;
    const imageData = await db.getImageData(imageId);
    if (imageData && imageData.imageData) {
      imageBuffer = imageData.imageData;
    } else {
      // Fallback to filesystem
      const imagePath = path.join(UPLOAD_DIR, image.filename);
      try {
        imageBuffer = await fs.readFile(imagePath);
      } catch {
        return res.status(404).json({ error: 'Image file not found. Please re-upload the image.' });
      }
    }

    // Parse numeric values explicitly to handle potential string inputs
    const processOptions = {
      width: 200,
      height: 200,
      brightness: parseInt(brightness) || 0,
      contrast: parseInt(contrast) || 0,
      sharpness: parseInt(sharpness) || 0,
      gamma: parseFloat(gamma) || 1.0,
      dithering: dithering || 'floydSteinberg',
      rotation: parseInt(rotation) || 0,
      flipH: !!flipH,
      flipV: !!flipV,
      invert: !!invert,
      cropX: parseFloat(cropX) || 0,
      cropY: parseFloat(cropY) || 0,
      cropW: parseFloat(cropW) || 1,
      cropH: parseFloat(cropH) || 1,
      textOverlay: textOverlay || '',
      textPosition: textPosition || 'bottom',
      textSize: textSize || 'medium'
    };

    console.log('Preview options:', { imageId, rotation: processOptions.rotation, flipH: processOptions.flipH, flipV: processOptions.flipV });

    const result = await imageProcessor.processImage(imageBuffer, processOptions);

    res.set('Content-Type', 'image/png');
    res.send(result.png);
  } catch (error) {
    console.error('Preview error:', error);
    next(error);
  }
});

// Apply processing and save image
app.post('/api/images/process', authenticate, async (req, res, next) => {
  try {
    const { imageId, brightness, contrast, sharpness, gamma, dithering, rotation, flipH, flipV, invert,
            cropX, cropY, cropW, cropH, textOverlay, textPosition, textSize } = req.body;

    if (!imageId) {
      return res.status(400).json({ error: 'Image ID required' });
    }

    const image = await db.getImageById(imageId);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    if (image.userId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    // Get original image from database
    let imageBuffer;
    const imageData = await db.getImageData(imageId);
    if (imageData && imageData.imageData) {
      imageBuffer = imageData.imageData;
    } else {
      const imagePath = path.join(UPLOAD_DIR, image.filename);
      try {
        imageBuffer = await fs.readFile(imagePath);
      } catch {
        return res.status(404).json({ error: 'Image file not found. Please re-upload.' });
      }
    }

    // Parse numeric values explicitly
    const processOptions = {
      width: 200,
      height: 200,
      brightness: parseInt(brightness) || 0,
      contrast: parseInt(contrast) || 0,
      sharpness: parseInt(sharpness) || 0,
      gamma: parseFloat(gamma) || 1.0,
      dithering: dithering || 'floydSteinberg',
      rotation: parseInt(rotation) || 0,
      flipH: !!flipH,
      flipV: !!flipV,
      invert: !!invert,
      cropX: parseFloat(cropX) || 0,
      cropY: parseFloat(cropY) || 0,
      cropW: parseFloat(cropW) || 1,
      cropH: parseFloat(cropH) || 1,
      textOverlay: textOverlay || '',
      textPosition: textPosition || 'bottom',
      textSize: textSize || 'medium'
    };

    console.log('Process options:', { imageId, rotation: processOptions.rotation });

    const result = await imageProcessor.processImage(imageBuffer, processOptions);

    // Save processed image to database
    await db.updateImageData(imageId, imageData?.imageData || imageBuffer, result.png);

    // Also update filesystem cache
    try {
      const imagePath = path.join(UPLOAD_DIR, image.filename);
      await fs.writeFile(imagePath, result.png);
    } catch {}

    res.json({ message: 'Image processed successfully' });
  } catch (error) {
    console.error('Process error:', error);
    next(error);
  }
});

// ESP32 bitmap endpoint - supports both photo carousel and dashboard mode
// This endpoint is smart: it decides what to show based on settings and auto-switch logic
app.get('/api/device/:deviceId/bitmap', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    let { index, mode } = req.query;

    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    await db.updateDevice(deviceId, { lastSeen: new Date().toISOString() });

    if (!device.userId) return res.status(404).json({ error: 'Device not linked to account' });

    // Get user settings for auto-switch logic
    const settings = await db.getUserSettings(device.userId) || { city: 'Warsaw', lang: 'pl', autoImageMode: 0, rotationInterval: 60 };
    const userImages = await db.getImagesByUserId(device.userId);

    // Determine display mode based on auto-switch logic
    let effectiveMode = mode || device.displayMode || 'dashboard';
    let currentIndex = index !== undefined ? parseInt(index) : (device.currentImageIndex || 0);

    // Auto-switch to photos after inactivity (if configured and images exist)
    if (settings.autoImageMode > 0 && userImages.length > 0 && device.lastUserActivity) {
      const lastActivity = new Date(device.lastUserActivity).getTime();
      const now = Date.now();
      const inactivityMinutes = (now - lastActivity) / (1000 * 60);

      if (inactivityMinutes >= settings.autoImageMode) {
        effectiveMode = 'photo';
      }
    }

    // If no images, always show dashboard
    if (userImages.length === 0) {
      effectiveMode = 'dashboard';
    }

    const displayConfig = DISPLAY_CONFIGS['default'];

    // Dashboard mode - render weather, calendar, todos
    if (effectiveMode === 'dashboard') {
      const [weather, events, todos] = await Promise.all([
        settings.city ? weatherModule.getWeatherByCity(settings.city) : null,
        calendarModule.getUpcomingEvents(device.userId, 3),
        todoModule.getActiveTodos(device.userId, 4)
      ]);

      const bitmap = await dashboardRenderer.renderDashboardBitmap({
        weather,
        events: events || [],
        todos: todos || [],
        date: new Date(),
        lang: settings.lang || 'pl'
      });

      if (!bitmap) {
        return res.status(500).json({ error: 'Failed to render dashboard' });
      }

      res.set({
        'Content-Type': 'application/octet-stream',
        'X-Image-Width': displayConfig.width,
        'X-Image-Height': displayConfig.height,
        'X-Image-Index': 0,
        'X-Image-Total': userImages.length,
        'X-Content-Type': 'dashboard',
        'X-Display-Mode': 'dashboard',
        'Access-Control-Expose-Headers': 'X-Image-Width, X-Image-Height, X-Image-Index, X-Image-Total, X-Content-Type, X-Display-Mode'
      });

      return res.send(bitmap);
    }

    // Photo carousel mode
    currentIndex = currentIndex % userImages.length;
    const image = userImages[currentIndex];

    // Update device with current index
    await db.updateDevice(deviceId, { currentImageIndex: currentIndex });

    // Try to get processed image from database first (has dithering applied)
    let bitmap;
    const imageData = await db.getImageData(image.id);

    if (imageData && imageData.processedData) {
      // Use pre-processed image with dithering from database
      const processedBuffer = imageData.processedData;

      // Convert PNG to 1-bit bitmap
      const { data } = await sharp(processedBuffer)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const bitmapSize = Math.ceil((displayConfig.width * displayConfig.height) / 8);
      bitmap = Buffer.alloc(bitmapSize);

      for (let i = 0; i < data.length; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8);
        if (data[i] > 127) bitmap[byteIndex] |= (1 << bitIndex);
      }
    } else {
      // Fallback: process image on the fly with dithering
      let imageBuffer;

      // Try database first
      if (imageData && imageData.imageData) {
        imageBuffer = imageData.imageData;
      } else {
        // Fallback to filesystem
        const imagePath = path.join(UPLOAD_DIR, image.filename);
        try {
          imageBuffer = await fs.readFile(imagePath);
        } catch {
          return res.status(404).json({ error: 'Image file not found. Please re-upload.' });
        }
      }

      // Process with dithering for better E-ink display
      const result = await imageProcessor.processImage(imageBuffer, {
        width: displayConfig.width,
        height: displayConfig.height,
        dithering: 'floydSteinberg'
      });

      bitmap = result.bitmap;
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Image-Width': displayConfig.width,
      'X-Image-Height': displayConfig.height,
      'X-Image-Index': currentIndex,
      'X-Image-Total': userImages.length,
      'X-Content-Type': 'photo',
      'X-Display-Mode': 'photo',
      'Access-Control-Expose-Headers': 'X-Image-Width, X-Image-Height, X-Image-Index, X-Image-Total, X-Content-Type, X-Display-Mode'
    });

    res.send(bitmap);
  } catch (error) {
    console.error('Bitmap endpoint error:', error);
    next(error);
  }
});

// Comprehensive device info endpoint - returns everything ESP32 needs
app.get('/api/device/:deviceId/image-info', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await db.getDeviceById(deviceId);
    if (!device || !device.userId) {
      return res.json({
        total: 0,
        currentIndex: 0,
        rotateMinutes: 60,
        autoImageMode: 0,
        refreshVersion: 0,
        displayMode: 'dashboard',
        shouldRefresh: false
      });
    }

    const [userImages, settings] = await Promise.all([
      db.getImagesByUserId(device.userId),
      db.getUserSettings(device.userId)
    ]);

    // Calculate if auto-switch should happen
    let effectiveMode = device.displayMode || 'dashboard';
    const autoImageMode = settings?.autoImageMode || 0;

    if (autoImageMode > 0 && userImages.length > 0 && device.lastUserActivity) {
      const lastActivity = new Date(device.lastUserActivity).getTime();
      const now = Date.now();
      const inactivityMinutes = (now - lastActivity) / (1000 * 60);

      if (inactivityMinutes >= autoImageMode) {
        effectiveMode = 'photo';
      }
    }

    // If no images, always dashboard
    if (userImages.length === 0) {
      effectiveMode = 'dashboard';
    }

    res.json({
      total: userImages.length,
      currentIndex: device.currentImageIndex || 0,
      rotateMinutes: settings?.rotationInterval || 60,
      autoImageMode: autoImageMode,
      refreshVersion: device.refreshVersion || 0,
      displayMode: effectiveMode,
      lastUserActivity: device.lastUserActivity,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Advance to next image (called by ESP32 for rotation)
app.post('/api/device/:deviceId/next-image', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const userImages = await db.getImagesByUserId(device.userId);

    if (userImages.length === 0) {
      return res.json({ nextIndex: 0, total: 0 });
    }

    const currentIndex = device.currentImageIndex || 0;
    const nextIndex = (currentIndex + 1) % userImages.length;

    // Update device with new index
    await db.updateDevice(deviceId, { currentImageIndex: nextIndex });

    res.json({ nextIndex, total: userImages.length });
  } catch (error) {
    next(error);
  }
});

// Set display mode (dashboard or photo) - called when user interacts
app.post('/api/device/:deviceId/set-mode', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { mode } = req.body;

    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const validModes = ['dashboard', 'photo'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use "dashboard" or "photo"' });
    }

    await db.updateDevice(deviceId, {
      displayMode: mode,
      lastUserActivity: new Date().toISOString()
    });

    res.json({ message: 'Mode set', displayMode: mode });
  } catch (error) {
    next(error);
  }
});

// ==================== COMPREHENSIVE ESP32 STATUS ENDPOINT ====================
// This is the main endpoint ESP32 should poll every 30-60 seconds
// It handles: refresh detection, auto-switch, image rotation - all automatically
app.get('/api/device/:deviceId/status', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { espVersion = 0 } = req.query; // ESP32's current known version

    const device = await db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Update last seen
    await db.updateDevice(deviceId, { lastSeen: new Date().toISOString() });

    if (!device.userId) {
      return res.json({
        shouldRefresh: false,
        displayMode: 'dashboard',
        refreshVersion: 0,
        imageIndex: 0,
        totalImages: 0,
        message: 'Device not linked'
      });
    }

    const [userImages, settings] = await Promise.all([
      db.getImagesByUserId(device.userId),
      db.getUserSettings(device.userId)
    ]);

    const serverVersion = device.refreshVersion || 0;
    const autoImageMode = settings?.autoImageMode || 0;
    const rotationInterval = settings?.rotationInterval || 60;
    const now = new Date();
    const nowISO = now.toISOString();
    const nowMs = now.getTime();

    let effectiveMode = device.displayMode || 'dashboard';
    let currentIndex = device.currentImageIndex || 0;
    let shouldRefresh = false;
    let refreshReason = null;

    // 1. Check if ESP32 needs to refresh due to version change (user made changes)
    if (serverVersion > parseInt(espVersion)) {
      shouldRefresh = true;
      refreshReason = 'version_changed';
    }

    // 2. Auto-switch logic: after inactivity, switch from dashboard to photos
    if (autoImageMode > 0 && userImages.length > 0 && device.lastUserActivity) {
      const lastActivity = new Date(device.lastUserActivity).getTime();
      const inactivityMinutes = (nowMs - lastActivity) / (1000 * 60);

      if (inactivityMinutes >= autoImageMode && effectiveMode === 'dashboard') {
        effectiveMode = 'photo';
        // Update device mode in database
        await db.updateDevice(deviceId, { displayMode: 'photo' });
        shouldRefresh = true;
        refreshReason = refreshReason || 'auto_switch_to_photos';
      }
    }

    // 3. Image rotation logic: cycle through photos at configured interval
    if (effectiveMode === 'photo' && userImages.length > 1) {
      const lastImageChange = device.lastImageChange ? new Date(device.lastImageChange).getTime() : 0;
      const timeSinceLastChange = (nowMs - lastImageChange) / (1000 * 60); // in minutes

      if (timeSinceLastChange >= rotationInterval || !device.lastImageChange) {
        // Time to rotate to next image
        const nextIndex = (currentIndex + 1) % userImages.length;
        currentIndex = nextIndex;

        // Update device with new index and timestamp
        await db.updateDevice(deviceId, {
          currentImageIndex: nextIndex,
          lastImageChange: nowISO
        });

        shouldRefresh = true;
        refreshReason = refreshReason || 'image_rotation';
      }
    }

    // 4. If no images available, force dashboard mode
    if (userImages.length === 0) {
      effectiveMode = 'dashboard';
    }

    // 5. Track that ESP32 has acknowledged this version
    if (shouldRefresh) {
      await db.updateDevice(deviceId, { lastEspVersion: serverVersion });
    }

    res.json({
      shouldRefresh,
      refreshReason,
      displayMode: effectiveMode,
      refreshVersion: serverVersion,
      imageIndex: currentIndex,
      totalImages: userImages.length,
      rotationIntervalMin: rotationInterval,
      autoSwitchMin: autoImageMode,
      serverTime: nowISO
    });

  } catch (error) {
    next(error);
  }
});

// ==================== LIGHTWEIGHT POLLING ENDPOINT FOR ESP32 ====================
// This is the main endpoint ESP32 should call every N seconds
// Returns compact JSON with control instructions

app.get('/api/device/:deviceId/poll', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { v: espVersion = 0, m: currentMode = 'dashboard', i: currentIndex = 0 } = req.query;

    const device = await db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ e: 'not_found' });
    }

    // Update last seen
    await db.updateDevice(deviceId, { lastSeen: new Date().toISOString() });

    if (!device.userId) {
      return res.json({
        r: false,      // refresh needed
        m: 'dashboard', // mode
        v: 0,          // version
        n: 60,         // next poll in seconds
        i: 0,          // image index
        t: 0           // total images
      });
    }

    const [userImages, settings] = await Promise.all([
      db.getImagesByUserId(device.userId),
      db.getUserSettings(device.userId)
    ]);

    const serverVersion = device.refreshVersion || 0;
    const autoImageMode = settings?.autoImageMode || 0;
    const rotationInterval = settings?.rotationInterval || 60;
    const now = Date.now();
    const nowISO = new Date().toISOString();

    let effectiveMode = device.displayMode || 'dashboard';
    let imageIndex = device.currentImageIndex || 0;
    let shouldRefresh = false;
    let nextPollSeconds = 30; // Default: poll every 30 seconds for responsiveness

    // 1. Version change detection (user made changes in web app)
    if (serverVersion > parseInt(espVersion)) {
      shouldRefresh = true;
      nextPollSeconds = 5; // Quick re-poll after refresh
      console.log(`[Poll] Device ${deviceId}: version changed ${espVersion} -> ${serverVersion}`);
    }

    // 2. Auto-switch logic: after inactivity, switch from dashboard to photos
    if (autoImageMode > 0 && userImages.length > 0 && device.lastUserActivity) {
      const lastActivity = new Date(device.lastUserActivity).getTime();
      const inactivityMinutes = (now - lastActivity) / (1000 * 60);

      if (inactivityMinutes >= autoImageMode && effectiveMode === 'dashboard') {
        effectiveMode = 'photo';
        await db.updateDevice(deviceId, { displayMode: 'photo' });
        shouldRefresh = true;
        console.log(`[Poll] Device ${deviceId}: auto-switch to photos after ${inactivityMinutes.toFixed(1)} min inactivity`);
      }

      // Calculate next poll: check closer to when auto-switch might happen
      const minutesUntilSwitch = autoImageMode - inactivityMinutes;
      if (minutesUntilSwitch > 0 && minutesUntilSwitch < 5) {
        nextPollSeconds = Math.max(10, Math.ceil(minutesUntilSwitch * 60));
      }
    }

    // 3. Image rotation logic: cycle through photos at configured interval
    if (effectiveMode === 'photo' && userImages.length > 1) {
      const lastImageChange = device.lastImageChange ? new Date(device.lastImageChange).getTime() : 0;
      const timeSinceLastChange = (now - lastImageChange) / (1000 * 60); // in minutes

      if (timeSinceLastChange >= rotationInterval || !device.lastImageChange) {
        // Time to rotate to next image
        const nextIndex = (imageIndex + 1) % userImages.length;
        imageIndex = nextIndex;

        // Update device with new index and timestamp
        await db.updateDevice(deviceId, {
          currentImageIndex: nextIndex,
          lastImageChange: nowISO
        });

        shouldRefresh = true;
        console.log(`[Poll] Device ${deviceId}: image rotation ${imageIndex-1} -> ${nextIndex}`);
      }

      // Next poll: when rotation should happen
      const minutesUntilRotation = rotationInterval - timeSinceLastChange;
      if (minutesUntilRotation > 0) {
        nextPollSeconds = Math.min(nextPollSeconds, Math.max(10, Math.ceil(minutesUntilRotation * 60)));
      }
    }

    // 4. No images = force dashboard mode
    if (userImages.length === 0) {
      effectiveMode = 'dashboard';
    }

    // Compact response (short keys to save bandwidth for ESP32)
    res.json({
      r: shouldRefresh,           // refresh needed
      m: effectiveMode,           // mode: 'dashboard' or 'photo'
      v: serverVersion,           // version number
      n: Math.min(300, Math.max(10, nextPollSeconds)), // next poll in seconds (10s - 5min)
      i: imageIndex,              // current image index
      t: userImages.length        // total images
    });

  } catch (error) {
    next(error);
  }
});

// ==================== WEATHER MODULE ====================

app.get('/api/weather', authenticate, async (req, res, next) => {
  try {
    const { lat, lon, city } = req.query;

    let weather;
    if (city) {
      weather = await weatherModule.getWeatherByCity(city);
    } else if (lat && lon) {
      weather = await weatherModule.getWeather(parseFloat(lat), parseFloat(lon));
    } else {
      return res.status(400).json({ error: 'Provide city or lat/lon coordinates' });
    }

    if (!weather) {
      return res.status(503).json({ error: 'Weather service unavailable. Check OPENWEATHER_API_KEY.' });
    }

    res.json({ weather });
  } catch (error) {
    next(error);
  }
});

// ==================== TODO MODULE ====================

app.get('/api/todos', authenticate, async (req, res, next) => {
  try {
    const todos = await todoModule.getTodos(req.user.id);
    res.json({ todos });
  } catch (error) {
    next(error);
  }
});

app.post('/api/todos', authenticate, async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Todo text is required' });
    }
    const todo = await todoModule.addTodo(req.user.id, text.trim());
    res.status(201).json({ todo });
  } catch (error) {
    next(error);
  }
});

app.put('/api/todos/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, completed } = req.body;
    await todoModule.updateTodo(req.user.id, id, { text, completed });
    res.json({ message: 'Todo updated' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/todos/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    await todoModule.deleteTodo(req.user.id, id);
    res.json({ message: 'Todo deleted' });
  } catch (error) {
    next(error);
  }
});

// ==================== GOOGLE OAUTH (for Calendar) ====================

// Google OAuth callback - exchanges code for tokens and saves to database
app.get('/api/auth/google/callback', async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;

    if (!code) {
      return res.status(400).send('Missing authorization code');
    }

    if (!userId) {
      return res.status(400).send('Missing user state');
    }

    // Use calendar module to handle the token exchange
    const success = await calendarModule.handleCallback(code, userId);

    if (success) {
      // Redirect back to app with success message
      res.redirect('/app?calendar=connected');
    } else {
      res.redirect('/app?calendar=error');
    }
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.redirect('/app?calendar=error');
  }
});

// ==================== CALENDAR MODULE ====================

app.get('/api/calendar/auth-url', authenticate, (req, res) => {
  const authUrl = calendarModule.getAuthUrl(req.user.id);
  if (!authUrl) {
    return res.status(503).json({ error: 'Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  }
  res.json({ authUrl });
});

app.get('/api/calendar/callback', async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;
    if (!code || !userId) {
      return res.status(400).send('Invalid callback parameters');
    }
    const success = await calendarModule.handleCallback(code, userId);
    if (success) {
      res.redirect('/app?calendar=connected');
    } else {
      res.redirect('/app?calendar=error');
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/calendar/status', authenticate, async (req, res, next) => {
  try {
    const configured = calendarModule.isConfigured();
    const connected = configured ? await calendarModule.isConnected(req.user.id) : false;
    res.json({ connected, configured });
  } catch (error) {
    next(error);
  }
});

app.get('/api/calendar/events', authenticate, async (req, res, next) => {
  try {
    const events = await calendarModule.getUpcomingEvents(req.user.id);
    if (events === null) {
      return res.status(401).json({ error: 'Calendar not connected' });
    }
    res.json({ events });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/calendar/disconnect', authenticate, async (req, res, next) => {
  try {
    await calendarModule.disconnect(req.user.id);
    res.json({ message: 'Calendar disconnected' });
  } catch (error) {
    next(error);
  }
});

// ==================== USER SETTINGS ====================

app.get('/api/settings', authenticate, async (req, res, next) => {
  try {
    const settings = await db.getUserSettings(req.user.id);
    res.json({ settings: settings || { city: 'Warsaw', displayMode: 'dashboard' } });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', authenticate, async (req, res, next) => {
  try {
    const { city, displayMode, lat, lon, rotationInterval, lang, autoImageMode } = req.body;
    await db.updateUserSettings(req.user.id, { city, displayMode, lat, lon, rotationInterval, lang, autoImageMode });
    res.json({ message: 'Settings updated' });
  } catch (error) {
    next(error);
  }
});

// ==================== DASHBOARD BITMAP ====================

app.get('/api/device/:deviceId/dashboard', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.userId) return res.status(404).json({ error: 'Device not linked' });

    // Get user settings
    const settings = await db.getUserSettings(device.userId) || { city: 'Warsaw' };

    // Gather dashboard data
    const [weather, events, todos] = await Promise.all([
      settings.city ? weatherModule.getWeatherByCity(settings.city) : null,
      calendarModule.getUpcomingEvents(device.userId, 3),
      todoModule.getActiveTodos(device.userId, 4)
    ]);

    // Render dashboard bitmap
    const bitmap = await dashboardRenderer.renderDashboardBitmap({
      weather,
      events: events || [],
      todos: todos || [],
      date: new Date(),
      lang: settings.lang || 'pl'
    });

    if (!bitmap) {
      return res.status(500).json({ error: 'Failed to render dashboard' });
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Image-Width': 200,
      'X-Image-Height': 200,
      'X-Content-Type': 'dashboard',
      'Access-Control-Expose-Headers': 'X-Image-Width, X-Image-Height, X-Content-Type'
    });

    res.send(bitmap);
  } catch (error) {
    next(error);
  }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development',
    storage: db.isUsingPostgres() ? 'PostgreSQL' : 'JSON files',
    databaseConnected: db.isUsingPostgres(),
    paths: {
      data: DATA_DIR,
      uploads: UPLOAD_DIR,
      web: WEB_DIR
    }
  });
});

// Debug endpoint - check database status
app.get('/api/debug/db', async (req, res) => {
  try {
    const status = {
      usingPostgres: db.isUsingPostgres(),
      envVars: {
        DATABASE_URL: !!process.env.DATABASE_URL,
        DATABASE_PUBLIC_URL: !!process.env.DATABASE_PUBLIC_URL,
        POSTGRES_URL: !!process.env.POSTGRES_URL
      }
    };

    if (db.isUsingPostgres()) {
      const devices = await db.getDevices();
      const users = await db.getUsers();
      status.data = {
        usersCount: Object.keys(users).length,
        devicesCount: Object.keys(devices).length,
        devices: Object.keys(devices)
      };
    }

    res.json(status);
  } catch (error) {
    res.json({ error: error.message, stack: error.stack });
  }
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((error, req, res, next) => {
  console.error('Error:', error);
  if (error.name === 'MulterError') {
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({
    error: isProduction ? 'Internal server error' : error.message
  });
});

// ==================== START SERVER ====================

async function init() {
  // Initialize database (PostgreSQL if DATABASE_URL set, otherwise JSON)
  await db.initDatabase();
  console.log(`Storage: ${db.isUsingPostgres() ? 'PostgreSQL' : 'JSON files'}`);

  // Initialize modules with database connection
  const pool = db.getPool();
  const isPostgres = db.isUsingPostgres();
  await todoModule.initTodoModule(pool, isPostgres);
  await calendarModule.initCalendarModule(pool, isPostgres);
  console.log('Modules initialized');

  // Create necessary directories
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  console.log('Directories initialized');

  // Verify web directory exists
  if (!fsSync.existsSync(WEB_DIR)) {
    console.error(`WARNING: Web directory not found at ${WEB_DIR}`);
  } else {
    const webFiles = await fs.readdir(WEB_DIR);
    console.log(`Web directory contents: ${webFiles.join(', ')}`);
  }
}

init().then(() => {
  app.listen(config.port, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   InkFrame API Server                         ║
║   Port: ${config.port}                                 ║
║   http://localhost:${config.port}                       ║
╚═══════════════════════════════════════════════╝
    `);
  });
});

module.exports = app;
