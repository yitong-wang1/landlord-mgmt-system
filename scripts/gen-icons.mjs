// 生成 PWA 所需 PNG 图标（纯 Node 内置模块，无第三方依赖）。
// 画一个蓝色背景 + 白色房屋图形，足够作为占位图标。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// CRC32 表
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const bg = [21, 101, 192]; // #1565c0
  const white = [255, 255, 255];
  // 房屋图形相对坐标（0..1）
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size / 2;
  const roofTop = size * 0.22;
  const roofBottom = size * 0.46;
  const houseLeft = size * 0.28;
  const houseRight = size * 0.72;
  const houseBottom = size * 0.78;
  const doorLeft = size * 0.44;
  const doorRight = size * 0.56;
  const doorBottom = houseBottom;

  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      let color = bg;
      const inRoof =
        y >= roofTop &&
        y <= roofBottom &&
        x >= cx - (y - roofTop) * ((cx - houseLeft) / (roofBottom - roofTop)) &&
        x <= cx + (y - roofTop) * ((cx - houseLeft) / (roofBottom - roofTop));
      const inBody =
        y > roofBottom &&
        y <= houseBottom &&
        x >= houseLeft &&
        x <= houseRight;
      const inDoor =
        inBody &&
        x >= doorLeft &&
        x <= doorRight &&
        y >= size * 0.58;
      if (inRoof || (inBody && !inDoor)) {
        color = white;
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, makePng(size));
  console.log('生成图标:', file);
}
