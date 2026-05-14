import sharp from 'sharp';

const FULL_MAX_DIMENSION = 1920;
const FULL_QUALITY = 80;
const THUMB_MAX_DIMENSION = 400;
const THUMB_QUALITY = 75;

export type ProcessedImage = {
  fullBuffer: Buffer;
  fullHeight: number;
  fullWidth: number;
  thumbBuffer: Buffer;
  thumbHeight: number;
  thumbWidth: number;
};

export const processImage = async (buffer: Buffer): Promise<ProcessedImage> => {
  const pipeline = sharp(buffer).rotate();

  const metadata = await pipeline.clone().metadata();
  const originalWidth = metadata.width!;
  const originalHeight = metadata.height!;

  const needsResize = originalWidth > FULL_MAX_DIMENSION || originalHeight > FULL_MAX_DIMENSION;

  const fullBuffer = await pipeline
    .clone()
    .resize({
      fit: 'inside',
      height: needsResize ? FULL_MAX_DIMENSION : undefined,
      width: needsResize ? FULL_MAX_DIMENSION : undefined,
      withoutEnlargement: true
    })
    .jpeg({ quality: FULL_QUALITY })
    .toBuffer();

  const thumbBuffer = await pipeline
    .clone()
    .resize({
      fit: 'inside',
      height: THUMB_MAX_DIMENSION,
      width: THUMB_MAX_DIMENSION,
      withoutEnlargement: true
    })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();

  const fullInfo = await sharp(fullBuffer).metadata();
  const thumbInfo = await sharp(thumbBuffer).metadata();

  return {
    fullBuffer,
    fullHeight: fullInfo.height!,
    fullWidth: fullInfo.width!,
    thumbBuffer,
    thumbHeight: thumbInfo.height!,
    thumbWidth: thumbInfo.width!
  };
};
