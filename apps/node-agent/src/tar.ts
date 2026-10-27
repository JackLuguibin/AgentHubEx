export type TarFile = { path: string; content: Buffer };

function checksum(header: Buffer): number {
  let sum = 0;
  for (const byte of header) sum += byte;
  return sum;
}

function headerFor(name: string, size: number): Buffer {
  if (name.length > 100) throw new Error("tar name too long");
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000777\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header[156] = 0x30;
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.fill(0x20, 148, 156);
  const sum = checksum(header);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

export function packTar(files: TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(headerFor(file.path, file.content.length), file.content);
    const pad = (512 - (file.content.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function unpackTar(buf: Buffer): TarFile[] {
  const files: TarFile[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").trim(), 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("bad tar size");
    const type = header[156];
    const content = buf.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    if (type === 0x35) continue;
    if (type !== 0x30 && type !== 0x00) throw new Error("unsupported tar entry");
    files.push({ path: name, content: Buffer.from(content) });
  }
  return files;
}
