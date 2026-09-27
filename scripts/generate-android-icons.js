import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcIcon = path.resolve(__dirname, '../public/app-icon-512.png');
const resDir = path.resolve(__dirname, '../android/app/src/main/res');

const sizes = [
  { folder: 'mipmap-mdpi', size: 48 },
  { folder: 'mipmap-hdpi', size: 72 },
  { folder: 'mipmap-xhdpi', size: 96 },
  { folder: 'mipmap-xxhdpi', size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

async function generate() {
  if (!fs.existsSync(srcIcon)) {
    console.error('Source icon not found:', srcIcon);
    return;
  }

  for (const { folder, size } of sizes) {
    const targetDir = path.join(resDir, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Standard square icon
    const iconPath = path.join(targetDir, 'ic_launcher.png');
    await sharp(srcIcon)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(iconPath);

    // Round icon (masked circle)
    const roundPath = path.join(targetDir, 'ic_launcher_round.png');
    const circleSvg = Buffer.from(
      `<svg><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`
    );
    await sharp(srcIcon)
      .resize(size, size, { fit: 'cover' })
      .composite([{ input: circleSvg, blend: 'dest-in' }])
      .png()
      .toFile(roundPath);

    // Foreground icon (for adaptive icons)
    const fgPath = path.join(targetDir, 'ic_launcher_foreground.png');
    await sharp(srcIcon)
      .resize(Math.round(size * 0.72), Math.round(size * 0.72))
      .extend({
        top: Math.round(size * 0.14),
        bottom: Math.round(size * 0.14),
        left: Math.round(size * 0.14),
        right: Math.round(size * 0.14),
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .resize(size, size)
      .png()
      .toFile(fgPath);

    console.log(`Generated icons for ${folder} (${size}x${size})`);
  }

  console.log('All Android mipmap icons generated successfully!');
}

generate().catch(console.error);
