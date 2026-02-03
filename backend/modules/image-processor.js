/**
 * Image Processor - Advanced image processing for E-ink displays
 * Supports dithering, brightness, contrast, sharpness, and more
 */

const sharp = require('sharp');

// Dithering algorithms
const DITHERING_ALGORITHMS = {
  none: 'none',
  floydSteinberg: 'floydSteinberg',
  atkinson: 'atkinson',
  ordered: 'ordered',
  bayer: 'bayer',
  sierra: 'sierra',
  stucki: 'stucki'
};

// Bayer matrix for ordered dithering
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map(row => row.map(v => (v / 16) * 255));

const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
].map(row => row.map(v => (v / 64) * 255));

/**
 * Simple 5x7 pixel font for text overlay (works without system fonts)
 */
const SIMPLE_FONT = {
  'A': [0x7E,0x11,0x11,0x11,0x7E], 'B': [0x7F,0x49,0x49,0x49,0x36], 'C': [0x3E,0x41,0x41,0x41,0x22],
  'D': [0x7F,0x41,0x41,0x22,0x1C], 'E': [0x7F,0x49,0x49,0x49,0x41], 'F': [0x7F,0x09,0x09,0x09,0x01],
  'G': [0x3E,0x41,0x49,0x49,0x7A], 'H': [0x7F,0x08,0x08,0x08,0x7F], 'I': [0x00,0x41,0x7F,0x41,0x00],
  'J': [0x20,0x40,0x41,0x3F,0x01], 'K': [0x7F,0x08,0x14,0x22,0x41], 'L': [0x7F,0x40,0x40,0x40,0x40],
  'M': [0x7F,0x02,0x0C,0x02,0x7F], 'N': [0x7F,0x04,0x08,0x10,0x7F], 'O': [0x3E,0x41,0x41,0x41,0x3E],
  'P': [0x7F,0x09,0x09,0x09,0x06], 'Q': [0x3E,0x41,0x51,0x21,0x5E], 'R': [0x7F,0x09,0x19,0x29,0x46],
  'S': [0x46,0x49,0x49,0x49,0x31], 'T': [0x01,0x01,0x7F,0x01,0x01], 'U': [0x3F,0x40,0x40,0x40,0x3F],
  'V': [0x1F,0x20,0x40,0x20,0x1F], 'W': [0x3F,0x40,0x38,0x40,0x3F], 'X': [0x63,0x14,0x08,0x14,0x63],
  'Y': [0x07,0x08,0x70,0x08,0x07], 'Z': [0x61,0x51,0x49,0x45,0x43],
  'a': [0x20,0x54,0x54,0x54,0x78], 'b': [0x7F,0x48,0x44,0x44,0x38], 'c': [0x38,0x44,0x44,0x44,0x20],
  'd': [0x38,0x44,0x44,0x48,0x7F], 'e': [0x38,0x54,0x54,0x54,0x18], 'f': [0x08,0x7E,0x09,0x01,0x02],
  'g': [0x0C,0x52,0x52,0x52,0x3E], 'h': [0x7F,0x08,0x04,0x04,0x78], 'i': [0x00,0x44,0x7D,0x40,0x00],
  'j': [0x20,0x40,0x44,0x3D,0x00], 'k': [0x7F,0x10,0x28,0x44,0x00], 'l': [0x00,0x41,0x7F,0x40,0x00],
  'm': [0x7C,0x04,0x18,0x04,0x78], 'n': [0x7C,0x08,0x04,0x04,0x78], 'o': [0x38,0x44,0x44,0x44,0x38],
  'p': [0x7C,0x14,0x14,0x14,0x08], 'q': [0x08,0x14,0x14,0x18,0x7C], 'r': [0x7C,0x08,0x04,0x04,0x08],
  's': [0x48,0x54,0x54,0x54,0x20], 't': [0x04,0x3F,0x44,0x40,0x20], 'u': [0x3C,0x40,0x40,0x20,0x7C],
  'v': [0x1C,0x20,0x40,0x20,0x1C], 'w': [0x3C,0x40,0x30,0x40,0x3C], 'x': [0x44,0x28,0x10,0x28,0x44],
  'y': [0x0C,0x50,0x50,0x50,0x3C], 'z': [0x44,0x64,0x54,0x4C,0x44],
  '0': [0x3E,0x51,0x49,0x45,0x3E], '1': [0x00,0x42,0x7F,0x40,0x00], '2': [0x42,0x61,0x51,0x49,0x46],
  '3': [0x21,0x41,0x45,0x4B,0x31], '4': [0x18,0x14,0x12,0x7F,0x10], '5': [0x27,0x45,0x45,0x45,0x39],
  '6': [0x3C,0x4A,0x49,0x49,0x30], '7': [0x01,0x71,0x09,0x05,0x03], '8': [0x36,0x49,0x49,0x49,0x36],
  '9': [0x06,0x49,0x49,0x29,0x1E],
  ' ': [0x00,0x00,0x00,0x00,0x00], '.': [0x00,0x60,0x60,0x00,0x00], ',': [0x00,0x80,0x60,0x00,0x00],
  ':': [0x00,0x36,0x36,0x00,0x00], '!': [0x00,0x00,0x5F,0x00,0x00], '?': [0x02,0x01,0x51,0x09,0x06],
  '-': [0x08,0x08,0x08,0x08,0x08], '_': [0x40,0x40,0x40,0x40,0x40], '+': [0x08,0x08,0x3E,0x08,0x08],
  '=': [0x14,0x14,0x14,0x14,0x14], '/': [0x20,0x10,0x08,0x04,0x02], '(': [0x00,0x1C,0x22,0x41,0x00],
  ')': [0x00,0x41,0x22,0x1C,0x00], '[': [0x00,0x7F,0x41,0x41,0x00], ']': [0x00,0x41,0x41,0x7F,0x00],
  // Polish characters
  'Ą': [0x7E,0x11,0x11,0x11,0xFE], 'Ć': [0x3E,0x41,0x41,0x45,0x22], 'Ę': [0x7F,0x49,0x49,0x49,0xC1],
  'Ł': [0x7F,0x48,0x70,0x40,0x40], 'Ń': [0x7F,0x04,0x0A,0x10,0x7F], 'Ó': [0x3E,0x45,0x41,0x41,0x3E],
  'Ś': [0x46,0x49,0x4B,0x49,0x31], 'Ź': [0x61,0x53,0x49,0x45,0x43], 'Ż': [0x61,0x55,0x49,0x45,0x43],
  'ą': [0x20,0x54,0x54,0x54,0xF8], 'ć': [0x38,0x44,0x46,0x44,0x20], 'ę': [0x38,0x54,0x54,0x54,0x98],
  'ł': [0x00,0x41,0x7F,0x60,0x00], 'ń': [0x7C,0x0A,0x04,0x04,0x78], 'ó': [0x38,0x46,0x44,0x44,0x38],
  'ś': [0x48,0x54,0x56,0x54,0x20], 'ź': [0x44,0x66,0x54,0x4C,0x44], 'ż': [0x44,0x56,0x54,0x4C,0x44]
};

/**
 * Draw text onto pixel buffer using bitmap font
 */
function drawTextOnPixels(pixels, width, height, text, position, size) {
  const scale = size === 'small' ? 1 : size === 'large' ? 2 : 1;
  const charWidth = 5 * scale;
  const charHeight = 7 * scale;
  const spacing = 1 * scale;
  const padding = 4;

  // Calculate text width
  const textWidth = text.length * (charWidth + spacing) - spacing;

  // Calculate position
  const startX = Math.floor((width - textWidth) / 2);
  let startY;
  if (position === 'top') {
    startY = padding;
  } else if (position === 'center') {
    startY = Math.floor((height - charHeight) / 2);
  } else {
    startY = height - charHeight - padding;
  }

  // Draw white background bar
  const barHeight = charHeight + 4;
  const barY = startY - 2;
  for (let y = Math.max(0, barY); y < Math.min(height, barY + barHeight); y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = 255; // White
    }
  }

  // Draw each character
  let x = startX;
  for (const char of text) {
    const charData = SIMPLE_FONT[char] || SIMPLE_FONT['?'];
    if (charData) {
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 7; row++) {
          if (charData[col] & (1 << row)) {
            // Draw scaled pixel
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = x + col * scale + sx;
                const py = startY + row * scale + sy;
                if (px >= 0 && px < width && py >= 0 && py < height) {
                  pixels[py * width + px] = 0; // Black
                }
              }
            }
          }
        }
      }
    }
    x += charWidth + spacing;
  }

  return pixels;
}

/**
 * Apply Floyd-Steinberg dithering
 */
function floydSteinbergDither(pixels, width, height) {
  const output = new Uint8Array(pixels.length);
  const errors = new Float32Array(pixels.length);

  // Copy original pixels
  for (let i = 0; i < pixels.length; i++) {
    errors[i] = pixels[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = errors[idx];
      const newPixel = oldPixel > 127 ? 255 : 0;
      output[idx] = newPixel;
      const error = oldPixel - newPixel;

      // Distribute error to neighboring pixels
      if (x + 1 < width) {
        errors[idx + 1] += error * 7 / 16;
      }
      if (y + 1 < height) {
        if (x > 0) {
          errors[idx + width - 1] += error * 3 / 16;
        }
        errors[idx + width] += error * 5 / 16;
        if (x + 1 < width) {
          errors[idx + width + 1] += error * 1 / 16;
        }
      }
    }
  }

  return output;
}

/**
 * Apply Atkinson dithering (looks great on E-ink)
 */
function atkinsonDither(pixels, width, height) {
  const output = new Uint8Array(pixels.length);
  const errors = new Float32Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    errors[i] = pixels[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = errors[idx];
      const newPixel = oldPixel > 127 ? 255 : 0;
      output[idx] = newPixel;
      const error = (oldPixel - newPixel) / 8;

      // Atkinson distributes 6/8 of error (loses 2/8)
      if (x + 1 < width) errors[idx + 1] += error;
      if (x + 2 < width) errors[idx + 2] += error;
      if (y + 1 < height) {
        if (x > 0) errors[idx + width - 1] += error;
        errors[idx + width] += error;
        if (x + 1 < width) errors[idx + width + 1] += error;
      }
      if (y + 2 < height) {
        errors[idx + width * 2] += error;
      }
    }
  }

  return output;
}

/**
 * Apply Sierra dithering
 */
function sierraDither(pixels, width, height) {
  const output = new Uint8Array(pixels.length);
  const errors = new Float32Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    errors[i] = pixels[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = errors[idx];
      const newPixel = oldPixel > 127 ? 255 : 0;
      output[idx] = newPixel;
      const error = oldPixel - newPixel;

      // Sierra lite kernel
      if (x + 1 < width) errors[idx + 1] += error * 2 / 4;
      if (y + 1 < height) {
        if (x > 0) errors[idx + width - 1] += error * 1 / 4;
        errors[idx + width] += error * 1 / 4;
      }
    }
  }

  return output;
}

/**
 * Apply Stucki dithering
 */
function stuckiDither(pixels, width, height) {
  const output = new Uint8Array(pixels.length);
  const errors = new Float32Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    errors[i] = pixels[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = errors[idx];
      const newPixel = oldPixel > 127 ? 255 : 0;
      output[idx] = newPixel;
      const error = oldPixel - newPixel;

      // Stucki kernel
      if (x + 1 < width) errors[idx + 1] += error * 8 / 42;
      if (x + 2 < width) errors[idx + 2] += error * 4 / 42;
      if (y + 1 < height) {
        if (x > 1) errors[idx + width - 2] += error * 2 / 42;
        if (x > 0) errors[idx + width - 1] += error * 4 / 42;
        errors[idx + width] += error * 8 / 42;
        if (x + 1 < width) errors[idx + width + 1] += error * 4 / 42;
        if (x + 2 < width) errors[idx + width + 2] += error * 2 / 42;
      }
      if (y + 2 < height) {
        if (x > 1) errors[idx + width * 2 - 2] += error * 1 / 42;
        if (x > 0) errors[idx + width * 2 - 1] += error * 2 / 42;
        errors[idx + width * 2] += error * 4 / 42;
        if (x + 1 < width) errors[idx + width * 2 + 1] += error * 2 / 42;
        if (x + 2 < width) errors[idx + width * 2 + 2] += error * 1 / 42;
      }
    }
  }

  return output;
}

/**
 * Apply ordered (Bayer) dithering
 */
function orderedDither(pixels, width, height, matrix = BAYER_4X4) {
  const output = new Uint8Array(pixels.length);
  const matrixSize = matrix.length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const threshold = matrix[y % matrixSize][x % matrixSize];
      output[idx] = pixels[idx] > threshold ? 255 : 0;
    }
  }

  return output;
}

/**
 * Apply Bayer 8x8 dithering
 */
function bayerDither(pixels, width, height) {
  return orderedDither(pixels, width, height, BAYER_8X8);
}

/**
 * Simple threshold (no dithering)
 */
function thresholdDither(pixels, width, height, threshold = 127) {
  const output = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    output[i] = pixels[i] > threshold ? 255 : 0;
  }
  return output;
}

/**
 * Apply dithering algorithm
 */
function applyDithering(pixels, width, height, algorithm) {
  switch (algorithm) {
    case 'floydSteinberg':
      return floydSteinbergDither(pixels, width, height);
    case 'atkinson':
      return atkinsonDither(pixels, width, height);
    case 'sierra':
      return sierraDither(pixels, width, height);
    case 'stucki':
      return stuckiDither(pixels, width, height);
    case 'ordered':
      return orderedDither(pixels, width, height, BAYER_4X4);
    case 'bayer':
      return bayerDither(pixels, width, height);
    case 'none':
    default:
      return thresholdDither(pixels, width, height);
  }
}

/**
 * Process image with all adjustments
 */
async function processImage(inputBuffer, options = {}) {
  const {
    width = 200,
    height = 200,
    brightness = 0,        // -100 to 100
    contrast = 0,          // -100 to 100
    sharpness = 0,         // 0 to 100
    gamma = 1.0,           // 0.5 to 2.0
    threshold = 127,       // 0 to 255
    invert = false,
    dithering = 'floydSteinberg',
    rotation = 0,          // 0, 90, 180, 270
    flipH = false,
    flipV = false,
    cropX = 0,             // crop start X (0-1)
    cropY = 0,             // crop start Y (0-1)
    cropW = 1,             // crop width (0-1)
    cropH = 1,             // crop height (0-1)
    fit = 'cover',         // cover, contain, fill
    textOverlay = '',      // text to add
    textPosition = 'bottom', // top, bottom, center
    textSize = 'medium'    // small, medium, large
  } = options;

  try {
    // Parse rotation as integer and normalize to 0, 90, 180, 270
    let rotationAngle = parseInt(rotation) || 0;
    rotationAngle = ((rotationAngle % 360) + 360) % 360; // Normalize to positive 0-359
    // Round to nearest 90 degrees
    rotationAngle = Math.round(rotationAngle / 90) * 90;

    let pipeline = sharp(inputBuffer);

    // Get metadata for cropping
    const metadata = await sharp(inputBuffer).metadata();
    const origWidth = metadata.width;
    const origHeight = metadata.height;

    // Apply rotation FIRST (before crop) so crop coordinates make sense
    // Sharp's rotate() will handle the dimension changes
    if (rotationAngle !== 0) {
      pipeline = pipeline.rotate(rotationAngle);
    }

    // Apply crop if specified (after rotation)
    if (cropX > 0 || cropY > 0 || cropW < 1 || cropH < 1) {
      // Get new dimensions after rotation
      const rotatedWidth = (rotationAngle === 90 || rotationAngle === 270) ? origHeight : origWidth;
      const rotatedHeight = (rotationAngle === 90 || rotationAngle === 270) ? origWidth : origHeight;

      const left = Math.round(parseFloat(cropX) * rotatedWidth);
      const top = Math.round(parseFloat(cropY) * rotatedHeight);
      const extractWidth = Math.round(parseFloat(cropW) * rotatedWidth);
      const extractHeight = Math.round(parseFloat(cropH) * rotatedHeight);

      pipeline = pipeline.extract({
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: Math.min(Math.max(1, extractWidth), rotatedWidth - left),
        height: Math.min(Math.max(1, extractHeight), rotatedHeight - top)
      });
    }

    // Apply flips
    if (flipH) pipeline = pipeline.flop();
    if (flipV) pipeline = pipeline.flip();

    // Resize to target dimensions
    pipeline = pipeline.resize(width, height, {
      fit: fit,
      position: 'center',
      background: { r: 255, g: 255, b: 255 }
    });

    // Convert to grayscale
    pipeline = pipeline.grayscale();

    // Apply gamma correction
    if (gamma !== 1.0) {
      pipeline = pipeline.gamma(gamma);
    }

    // Apply sharpening
    if (sharpness > 0) {
      const sigma = 0.5 + (sharpness / 100) * 2;
      pipeline = pipeline.sharpen(sigma);
    }

    // Apply brightness and contrast using linear transform
    // y = contrast * x + brightness
    if (brightness !== 0 || contrast !== 0) {
      const a = 1 + contrast / 100;  // contrast multiplier
      const b = brightness * 2.55;    // brightness offset (0-255 scale)
      pipeline = pipeline.linear(a, b);
    }

    // Normalize to improve contrast
    pipeline = pipeline.normalize();

    // Get raw pixel data
    const { data, info } = await pipeline
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Apply dithering first (before text, so text stays crisp)
    let processedPixels = applyDithering(data, info.width, info.height, dithering);

    // Add text overlay if specified (after dithering so text is clean)
    if (textOverlay && textOverlay.trim()) {
      processedPixels = drawTextOnPixels(processedPixels, info.width, info.height, textOverlay.trim(), textPosition, textSize);
    }

    // Apply inversion if requested
    if (invert) {
      for (let i = 0; i < processedPixels.length; i++) {
        processedPixels[i] = 255 - processedPixels[i];
      }
    }

    // Convert to PNG for preview
    const pngBuffer = await sharp(Buffer.from(processedPixels), {
      raw: { width: info.width, height: info.height, channels: 1 }
    }).png().toBuffer();

    // Convert to 1-bit bitmap for E-ink
    const bitmapSize = Math.ceil((info.width * info.height) / 8);
    const bitmap = Buffer.alloc(bitmapSize);

    for (let i = 0; i < processedPixels.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      if (processedPixels[i] > 127) {
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }

    return {
      png: pngBuffer,
      bitmap: bitmap,
      width: info.width,
      height: info.height
    };
  } catch (error) {
    console.error('Image processing error:', error);
    throw error;
  }
}

/**
 * Generate preview with specific settings
 */
async function generatePreview(inputBuffer, options = {}) {
  const result = await processImage(inputBuffer, options);
  return result.png;
}

/**
 * Generate final bitmap for E-ink
 */
async function generateBitmap(inputBuffer, options = {}) {
  const result = await processImage(inputBuffer, options);
  return result.bitmap;
}

/**
 * Get available dithering algorithms
 */
function getDitheringAlgorithms() {
  return [
    { id: 'none', name: 'None (Threshold)', description: 'Simple black/white threshold' },
    { id: 'floydSteinberg', name: 'Floyd-Steinberg', description: 'Classic error diffusion, best overall quality' },
    { id: 'atkinson', name: 'Atkinson', description: 'Lighter result, great for E-ink displays' },
    { id: 'sierra', name: 'Sierra Lite', description: 'Fast with good quality' },
    { id: 'stucki', name: 'Stucki', description: 'Smooth gradients, larger error diffusion' },
    { id: 'ordered', name: 'Ordered 4x4', description: 'Pattern-based, retro look' },
    { id: 'bayer', name: 'Bayer 8x8', description: 'Larger pattern, smoother gradients' }
  ];
}

module.exports = {
  processImage,
  generatePreview,
  generateBitmap,
  getDitheringAlgorithms,
  DITHERING_ALGORITHMS,
  applyDithering,
  floydSteinbergDither,
  atkinsonDither
};
