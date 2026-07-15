'use strict';
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const iconDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });

const svgIcon = size => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="#1B3A6B"/>
  <text x="50%" y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${Math.round(size * 0.28)}"
    font-weight="bold"
    fill="#FFFFFF">CIQ</text>
</svg>`;

async function generate() {
  for (const size of [192, 512]) {
    const outPath = path.join(iconDir, `icon-${size}.png`);
    await sharp(Buffer.from(svgIcon(size))).png().toFile(outPath);
    console.log(`Generated icon-${size}.png`);
  }
}

generate().catch(err => { console.error(err); process.exit(1); });
