import { inflateRawSync } from "node:zlib";

export type ZipEntry = { path: string; data: Buffer; symlink: boolean };

export function unzipStored(
  buf: Buffer,
  limits?: { maxEntries?: number; maxUncompressed?: number },
): ZipEntry[] {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("invalid zip");
  const count = buf.readUInt16LE(eocd + 10);
  if (limits?.maxEntries != null && count > limits.maxEntries) {
    throw new Error("zip has too many entries");
  }
  let ptr = buf.readUInt32LE(eocd + 16);
  const files: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("bad central directory");
    const madeBy = buf.readUInt16LE(ptr + 4);
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const externalAttr = buf.readUInt32LE(ptr + 38);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataOff, dataOff + compSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`unsupported zip method ${method}`);
    total += data.length;
    if (limits?.maxUncompressed != null && total > limits.maxUncompressed) {
      throw new Error("zip is too large");
    }
    const unix = madeBy >>> 8 === 3;
    const mode = unix ? (externalAttr >>> 16) & 0xffff : 0;
    const symlink = (mode & 0o170000) === 0o120000;
    files.push({ path: name, data, symlink });
  }
  return files;
}
