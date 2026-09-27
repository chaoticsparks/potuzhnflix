// tv-fonts.mjs — fonts for the TV screen (mpv's OSD via libass), written to player/fonts.
// libass reads TTF/OTF only; @fontsource ships WOFF, which is TTF with zlib-compressed tables,
// so it is unpacked here. Subsets (cyrillic + latin) are separate files of the same family;
// libass picks whichever file has the glyph.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = path.join(root, 'node_modules');
const out = path.join(root, 'player', 'fonts');

// The TV screen is a VHS-era blue screen: one blocky pixel font for everything
const WOFF = [
  '@fontsource/press-start-2p/files/press-start-2p-cyrillic-400-normal.woff',
  '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff',
];
const TTF = [];

// WOFF 1.0 → SFNT (https://www.w3.org/TR/WOFF/)
function woffToSfnt(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const tag = woff.readUInt32BE(at);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const checksum = woff.readUInt32BE(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : raw;
    tables.push({ tag, checksum, data });
  }

  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const headerSize = 12 + numTables * 16;
  const size = tables.reduce((s, t) => s + Math.ceil(t.data.length / 4) * 4, headerSize);
  const sfnt = Buffer.alloc(size);

  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(numTables, 4);
  sfnt.writeUInt16BE(searchRange, 6);
  sfnt.writeUInt16BE(entrySelector, 8);
  sfnt.writeUInt16BE(numTables * 16 - searchRange, 10);

  let offset = headerSize;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    sfnt.writeUInt32BE(t.tag, at);
    sfnt.writeUInt32BE(t.checksum, at + 4);
    sfnt.writeUInt32BE(offset, at + 8);
    sfnt.writeUInt32BE(t.data.length, at + 12);
    t.data.copy(sfnt, offset);
    offset += Math.ceil(t.data.length / 4) * 4;   // tables are 4-byte aligned
  });
  return sfnt;
}

fs.mkdirSync(out, { recursive: true });
for (const rel of WOFF) {
  const name = path.basename(rel).replace(/\.woff$/, '.ttf');
  fs.writeFileSync(path.join(out, name), woffToSfnt(fs.readFileSync(path.join(modules, rel))));
}
for (const rel of TTF) {
  fs.copyFileSync(path.join(modules, rel), path.join(out, path.basename(rel)));
}
console.log(`TV fonts → ${path.relative(root, out)} (${WOFF.length + TTF.length} files)`);
