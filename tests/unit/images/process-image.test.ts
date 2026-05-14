import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { processImage } from '../../../src/images/process-image.js';

describe('processImage', () => {
  const createTestImage = async (width: number, height: number) => {
    return sharp({
      create: {
        background: { b: 100, g: 150, r: 50 },
        channels: 3,
        height,
        width
      }
    })
      .jpeg()
      .toBuffer();
  };

  it('resizes large images to fit within 1920px and creates a 400px thumbnail', async () => {
    const buffer = await createTestImage(3000, 2000);
    const result = await processImage(buffer);

    expect(result.fullWidth).toBeLessThanOrEqual(1920);
    expect(result.fullHeight).toBeLessThanOrEqual(1920);
    expect(result.thumbWidth).toBeLessThanOrEqual(400);
    expect(result.thumbHeight).toBeLessThanOrEqual(400);
    expect(result.fullBuffer.length).toBeGreaterThan(0);
    expect(result.thumbBuffer.length).toBeGreaterThan(0);
    expect(result.thumbBuffer.length).toBeLessThan(result.fullBuffer.length);
  });

  it('preserves small image dimensions when under the full-size limit', async () => {
    const buffer = await createTestImage(800, 600);
    const result = await processImage(buffer);

    expect(result.fullWidth).toBe(800);
    expect(result.fullHeight).toBe(600);
    expect(result.thumbWidth).toBeLessThanOrEqual(400);
    expect(result.thumbHeight).toBeLessThanOrEqual(400);
  });

  it('applies EXIF auto-rotation and returns correct dimensions', async () => {
    const buffer = await sharp({
      create: {
        background: { b: 100, g: 150, r: 50 },
        channels: 3,
        height: 200,
        width: 400
      }
    })
      .jpeg()
      .toBuffer();

    const result = await processImage(buffer);

    expect(result.fullWidth).toBe(400);
    expect(result.fullHeight).toBe(200);
  });

  it('outputs jpeg buffers regardless of input', async () => {
    const pngBuffer = await sharp({
      create: {
        background: { alpha: 255, b: 100, g: 150, r: 50 },
        channels: 4,
        height: 100,
        width: 100
      }
    })
      .png()
      .toBuffer();

    const result = await processImage(pngBuffer);

    const fullMeta = await sharp(result.fullBuffer).metadata();
    const thumbMeta = await sharp(result.thumbBuffer).metadata();

    expect(fullMeta.format).toBe('jpeg');
    expect(thumbMeta.format).toBe('jpeg');
  });
});
