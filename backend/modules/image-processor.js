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
    fit = 'cover'          // cover, contain, fill
  } = options;

  try {
    let pipeline = sharp(inputBuffer);

    // Get metadata for cropping
    const metadata = await sharp(inputBuffer).metadata();
    const origWidth = metadata.width;
    const origHeight = metadata.height;

    // Apply crop if specified
    if (cropX > 0 || cropY > 0 || cropW < 1 || cropH < 1) {
      const left = Math.round(cropX * origWidth);
      const top = Math.round(cropY * origHeight);
      const extractWidth = Math.round(cropW * origWidth);
      const extractHeight = Math.round(cropH * origHeight);

      pipeline = pipeline.extract({
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: Math.min(extractWidth, origWidth - left),
        height: Math.min(extractHeight, origHeight - top)
      });
    }

    // Apply rotation
    if (rotation !== 0) {
      pipeline = pipeline.rotate(rotation);
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

    // Apply dithering
    let processedPixels = applyDithering(data, info.width, info.height, dithering);

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
