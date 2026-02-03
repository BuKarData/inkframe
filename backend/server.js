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

    const { deviceId, title, adjustments: adjustmentsStr } = req.body;
    let adjustments = {};
    try { if (adjustmentsStr) adjustments = JSON.parse(adjustmentsStr); } catch (e) {}

    const displayConfig = DISPLAY_CONFIGS['default'];
    const targetWidth = displayConfig.width;
    const targetHeight = displayConfig.height;

    const filename = `${uuidv4()}.png`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Ensure upload directory exists
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // Process image
    let pipeline = sharp(req.file.buffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' })
      .grayscale()
      .normalize();

    if (adjustments.brightness || adjustments.contrast) {
      const brightness = (adjustments.brightness || 0) / 100;
      const contrast = 1 + (adjustments.contrast || 0) / 100;
      pipeline = pipeline.modulate({ brightness: 1 + brightness })
        .linear(contrast, -(128 * contrast) + 128);
    }

    const outputBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    await fs.writeFile(filepath, outputBuffer);

    console.log(`Image saved to: ${filepath}`);

    const image = await db.createImage({
      id: uuidv4(),
      userId: req.user.id,
      filename,
      originalName: req.file.originalname
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
    console.error('Upload error:', error);
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
        url: `/uploads/${i.filename}`,
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

// ESP32 bitmap endpoint
app.get('/api/device/:deviceId/bitmap', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { index = 0 } = req.query;

    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    await db.updateDevice(deviceId, { lastSeen: new Date().toISOString() });

    if (!device.userId) return res.status(404).json({ error: 'Device not linked to account' });

    const userImages = await db.getImagesByUserId(device.userId);
    if (userImages.length === 0) return res.status(404).json({ error: 'No images available' });

    const imageIndex = parseInt(index) % userImages.length;
    const image = userImages[imageIndex];
    const imagePath = path.join(UPLOAD_DIR, image.filename);

    try {
      await fs.access(imagePath);
    } catch {
      return res.status(404).json({ error: 'Image file not found' });
    }

    const displayConfig = DISPLAY_CONFIGS['default'];

    const { data } = await sharp(imagePath)
      .resize(displayConfig.width, displayConfig.height, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bitmapSize = Math.ceil((displayConfig.width * displayConfig.height) / 8);
    const bitmap = Buffer.alloc(bitmapSize);

    for (let i = 0; i < data.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      if (data[i] > 127) bitmap[byteIndex] |= (1 << bitIndex);
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Image-Width': displayConfig.width,
      'X-Image-Height': displayConfig.height,
      'X-Image-Index': imageIndex,
      'X-Image-Total': userImages.length,
      'Access-Control-Expose-Headers': 'X-Image-Width, X-Image-Height, X-Image-Index, X-Image-Total'
    });

    res.send(bitmap);
  } catch (error) {
    next(error);
  }
});

app.get('/api/device/:deviceId/image-info', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await db.getDeviceById(deviceId);
    if (!device || !device.userId) return res.json({ total: 0, currentIndex: 0 });

    const userImages = await db.getImagesByUserId(device.userId);

    res.json({
      total: userImages.length,
      currentIndex: 0,
      rotateMinutes: 60
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/device/:deviceId/next-image', optionalAuth, async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await db.getDeviceById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const userImages = await db.getImagesByUserId(device.userId);

    res.json({ nextIndex: 0, total: userImages.length });
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
    paths: {
      data: DATA_DIR,
      uploads: UPLOAD_DIR,
      web: WEB_DIR
    }
  });
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
