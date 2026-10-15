import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data = Buffer.alloc(0)) { const name = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
function segmentDistance(px, py, ax, ay, bx, by) { const dx=bx-ax, dy=by-ay; const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy))); return Math.hypot(px-(ax+t*dx),py-(ay+t*dy)); }
function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y=0; y<size; y++) {
    const row=y*(size*4+1); raw[row]=0;
    for (let x=0; x<size; x++) {
      const i=row+1+x*4, nx=x/size, ny=y/size;
      let color=[13,118,110,255];
      const check = Math.min(segmentDistance(nx,ny,.29,.52,.43,.66),segmentDistance(nx,ny,.43,.66,.72,.33));
      if (check < .043) color=[255,255,255,255];
      if (Math.hypot(nx-.73,ny-.73)<.074) color=[243,184,75,255];
      raw.set(color,i);
    }
  }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:9})),chunk("IEND")]);
}
mkdirSync(new URL("../dist/icons/", import.meta.url), { recursive: true });
for (const size of [192,512]) writeFileSync(new URL(`../dist/icons/icon-${size}.png`, import.meta.url), makeIcon(size));
