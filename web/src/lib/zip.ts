// A minimal .zip writer: stored entries only (no compression). The scan
// point builder uses it to package six face images in the browser, in the
// same format the API already accepts, without adding a dependency. JPEG and
// PNG are already compressed, so storing them costs nothing.
// Format: PKWARE APPNOTE, local headers + central directory + end record.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const DOS_DATE_1980 = 0x21; // 1 Jan 1980: no timestamps needed
const UTF8_NAMES = 0x0800;

export function zipStore(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const files = entries.map((e) => ({ ...e, nameBytes: encoder.encode(e.name), crc: crc32(e.data) }));
  const localSize = files.reduce((n, f) => n + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.nameBytes.length, 0);
  const out = new Uint8Array(new ArrayBuffer(localSize + centralSize + 22));
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(at, v, true);
    at += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, at);
    at += b.length;
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034b50); // local file header
    u16(20); // version needed
    u16(UTF8_NAMES);
    u16(0); // method: stored
    u16(0); // time
    u16(DOS_DATE_1980);
    u32(f.crc);
    u32(f.data.length); // compressed size
    u32(f.data.length); // size
    u16(f.nameBytes.length);
    u16(0); // extra length
    bytes(f.nameBytes);
    bytes(f.data);
  }

  const centralStart = at;
  files.forEach((f, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by
    u16(20); // version needed
    u16(UTF8_NAMES);
    u16(0);
    u16(0);
    u16(DOS_DATE_1980);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.nameBytes.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    bytes(f.nameBytes);
  });

  const centralLength = at - centralStart;
  u32(0x06054b50); // end of central directory
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(centralLength);
  u32(centralStart);
  u16(0); // comment length
  return out;
}
