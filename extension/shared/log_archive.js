(() => {
  "use strict";

  if (globalThis.FCI_LOG_ARCHIVE?.VERSION >= 1) return;

  const encoder = new TextEncoder();
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[index] = value >>> 0;
    }
    return table;
  })();

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return encoder.encode(String(value ?? ""));
  }

  function concatBytes(parts) {
    const normalized = parts.map(toBytes);
    const total = normalized.reduce((sum, part) => sum + part.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of normalized) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }

  function crc32(value) {
    const bytes = toBytes(value);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, Number(value) & 0xffff, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, Number(value) >>> 0, true);
  }

  function dosDateTime(rawDate) {
    const date = rawDate instanceof Date ? rawDate : new Date(rawDate || Date.now());
    const safe = Number.isFinite(date.getTime()) ? date : new Date();
    const year = Math.max(1980, Math.min(2107, safe.getFullYear()));
    return {
      time: ((safe.getHours() & 0x1f) << 11) | ((safe.getMinutes() & 0x3f) << 5) | ((Math.floor(safe.getSeconds() / 2)) & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | (((safe.getMonth() + 1) & 0x0f) << 5) | (safe.getDate() & 0x1f)
    };
  }

  function sanitizeEntryName(value) {
    const parts = String(value || "file").replace(/\\/g, "/").split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 160));
    return (parts.join("/") || "file").slice(0, 512);
  }

  function safeDownloadStem(value, fallback = "command-run") {
    const normalized = String(value || fallback).normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
    return normalized || fallback;
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") throw new Error("This Firefox version does not provide CompressionStream.");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function buildZip(rawEntries, options = {}) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    if (!entries.length) throw new Error("The command-run archive has no files.");
    if (entries.length > 0xffff) throw new Error("The ZIP archive contains too many files.");
    const modifiedAt = options.modifiedAt || new Date();
    const { time, date } = dosDateTime(modifiedAt);
    const records = [];
    let localOffset = 0;

    for (const rawEntry of entries) {
      const name = sanitizeEntryName(rawEntry?.name);
      const nameBytes = encoder.encode(name);
      const data = toBytes(rawEntry?.data);
      if (data.byteLength > 0xffffffff) throw new Error(`The archive entry is too large: ${name}`);
      const compressed = rawEntry?.compress === false ? data : await deflateRaw(data);
      const useDeflate = rawEntry?.compress !== false && compressed.byteLength < data.byteLength;
      const payload = useDeflate ? compressed : data;
      const method = useDeflate ? 8 : 0;
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0x0800);
      writeUint16(localView, 8, method);
      writeUint16(localView, 10, time);
      writeUint16(localView, 12, date);
      writeUint32(localView, 14, checksum);
      writeUint32(localView, 18, payload.byteLength);
      writeUint32(localView, 22, data.byteLength);
      writeUint16(localView, 26, nameBytes.byteLength);
      writeUint16(localView, 28, 0);
      const localRecord = concatBytes([localHeader, nameBytes, payload]);
      records.push({ name, nameBytes, data, payload, method, checksum, time, date, localOffset, localRecord });
      localOffset += localRecord.byteLength;
      if (localOffset > 0xffffffff) throw new Error("The ZIP archive exceeds the classic ZIP size limit.");
    }

    const centralRecords = records.map((record) => {
      const header = new Uint8Array(46);
      const view = new DataView(header.buffer);
      writeUint32(view, 0, 0x02014b50);
      writeUint16(view, 4, 0x0314);
      writeUint16(view, 6, 20);
      writeUint16(view, 8, 0x0800);
      writeUint16(view, 10, record.method);
      writeUint16(view, 12, record.time);
      writeUint16(view, 14, record.date);
      writeUint32(view, 16, record.checksum);
      writeUint32(view, 20, record.payload.byteLength);
      writeUint32(view, 24, record.data.byteLength);
      writeUint16(view, 28, record.nameBytes.byteLength);
      writeUint16(view, 30, 0);
      writeUint16(view, 32, 0);
      writeUint16(view, 34, 0);
      writeUint16(view, 36, 0);
      writeUint32(view, 38, 0);
      writeUint32(view, 42, record.localOffset);
      return concatBytes([header, record.nameBytes]);
    });
    const centralDirectory = concatBytes(centralRecords);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, records.length);
    writeUint16(endView, 10, records.length);
    writeUint32(endView, 12, centralDirectory.byteLength);
    writeUint32(endView, 16, localOffset);
    writeUint16(endView, 20, 0);
    return concatBytes([...records.map((record) => record.localRecord), centralDirectory, end]);
  }

  Object.defineProperty(globalThis, "FCI_LOG_ARCHIVE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ VERSION: 1, buildZip, concatBytes, crc32, safeDownloadStem, sanitizeEntryName, toBytes })
  });
})();
