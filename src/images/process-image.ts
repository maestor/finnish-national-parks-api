import sharp from 'sharp';

const FULL_MAX_DIMENSION = 2560;
const FULL_QUALITY = 82;
const MAX_INPUT_PIXELS = 40_000_000;
const THUMB_MAX_DIMENSION = 480;
const THUMB_QUALITY_STEPS = [83, 74, 66, 58, 50] as const;
const THUMB_TARGET_BYTES = 150 * 1024;

export class ImageProcessingError extends Error {
  constructor(message = 'Image processing failed.') {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export type ProcessedImage = {
  fullBuffer: Buffer;
  fullHeight: number;
  fullWidth: number;
  thumbBuffer: Buffer;
  thumbHeight: number;
  thumbWidth: number;
};

export const processImage = async (buffer: Buffer): Promise<ProcessedImage> => {
  try {
    const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .flatten({ background: '#ffffff' });

    const fullBuffer = await pipeline
      .clone()
      .resize({
        fit: 'inside',
        height: FULL_MAX_DIMENSION,
        width: FULL_MAX_DIMENSION,
        withoutEnlargement: true
      })
      .jpeg({ quality: FULL_QUALITY })
      .toBuffer();

    const createThumbnail = async (quality: number) => {
      return pipeline
        .clone()
        .resize({
          fit: 'inside',
          height: THUMB_MAX_DIMENSION,
          width: THUMB_MAX_DIMENSION,
          withoutEnlargement: true
        })
        .jpeg({ quality })
        .toBuffer();
    };
    let thumbBuffer = await createThumbnail(THUMB_QUALITY_STEPS[0]);

    for (const quality of THUMB_QUALITY_STEPS.slice(1)) {
      if (thumbBuffer.length <= THUMB_TARGET_BYTES) {
        break;
      }

      thumbBuffer = await createThumbnail(quality);
    }

    const [fullInfo, thumbInfo] = await Promise.all([
      sharp(fullBuffer).metadata(),
      sharp(thumbBuffer).metadata()
    ]);

    return {
      fullBuffer,
      fullHeight: fullInfo.height!,
      fullWidth: fullInfo.width!,
      thumbBuffer,
      thumbHeight: thumbInfo.height!,
      thumbWidth: thumbInfo.width!
    };
  } catch {
    throw new ImageProcessingError();
  }
};
