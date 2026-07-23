(() => {
  "use strict";

  if (globalThis.FCI_SUPPORT_BUNDLE?.VERSION >= 1) {
    return;
  }

  const encoder = new TextEncoder();
  const REDACTED = "[redacted]";
  const OMITTED = "[omitted]";
  const SENSITIVE_KEYS = new Set([
    "sessiontoken",
    "command",
    "workingdirectory",
    "cwd",
    "output",
    "shelloutput",
    "title",
    "originaltitle",
    "displayedtitle"
  ]);

  let crcTable = null;

  function sanitizeUrl(value) {
    const text = String(value || "");
    if (!text) {
      return text;
    }
    try {
      const parsed = new URL(text);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch (_error) {
      return text.replace(/[?#].*$/, "");
    }
  }

  function sanitizeValue(value, key = "", seen = new WeakSet()) {
    const normalizedKey = String(key || "").toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      return normalizedKey.includes("title") ? OMITTED : REDACTED;
    }
    if (normalizedKey === "url") {
      return sanitizeUrl(value);
    }
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, key, seen));
    }
    if (typeof value !== "object") {
      return String(value);
    }
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeValue(childValue, childKey, seen);
    }
    seen.delete(value);
    return result;
  }

  function jsonText(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function bundleEntries(bundle) {
    const entries = [
      {
        name: "metadata.json",
        content: jsonText({
          formatVersion: bundle.formatVersion,
          generatedAt: bundle.generatedAt,
          extension: bundle.extension,
          environment: bundle.environment,
          diagnostics: bundle.diagnostics,
          privacy: bundle.privacy
        })
      },
      { name: "settings.json", content: jsonText(bundle.settings || {}) },
      { name: "sessions.json", content: jsonText(bundle.sessions || []) },
      { name: "native-host.json", content: jsonText(bundle.nativeHost || {}) }
    ];
    const logs = bundle.logs && typeof bundle.logs === "object" ? bundle.logs : {};
    for (const name of Object.keys(logs).sort()) {
      entries.push({ name: `logs/${name}`, content: jsonText(logs[name]) });
    }
    return entries;
  }

  function getCrcTable() {
    if (crcTable) {
      return crcTable;
    }
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2)) & 0x1f);
    const day = ((year - 1980) & 0x7f) << 9 |
      ((date.getMonth() + 1) & 0x0f) << 5 |
      (date.getDate() & 0x1f);
    return { time, date: day };
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function buildZip(entries, now = new Date()) {
    const localParts = [];
    const centralParts = [];
    const stamp = dosDateTime(now);
    let localOffset = 0;

    for (const entry of entries) {
      const name = encoder.encode(String(entry.name || "file.json"));
      const data = entry.content instanceof Uint8Array
        ? entry.content
        : encoder.encode(String(entry.content ?? ""));
      const crc = crc32(data);
      const localHeader = new Uint8Array(30 + name.length);
      const localView = new DataView(localHeader.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0x0800);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, stamp.time);
      writeUint16(localView, 12, stamp.date);
      writeUint32(localView, 14, crc);
      writeUint32(localView, 18, data.length);
      writeUint32(localView, 22, data.length);
      writeUint16(localView, 26, name.length);
      writeUint16(localView, 28, 0);
      localHeader.set(name, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + name.length);
      const centralView = new DataView(centralHeader.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, 0x0800);
      writeUint16(centralView, 10, 0);
      writeUint16(centralView, 12, stamp.time);
      writeUint16(centralView, 14, stamp.date);
      writeUint32(centralView, 16, crc);
      writeUint32(centralView, 20, data.length);
      writeUint32(centralView, 24, data.length);
      writeUint16(centralView, 28, name.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, localOffset);
      centralHeader.set(name, 46);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + data.length;
    }

    const centralDirectory = concat(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, entries.length);
    writeUint16(endView, 10, entries.length);
    writeUint32(endView, 12, centralDirectory.length);
    writeUint32(endView, 16, localOffset);
    writeUint16(endView, 20, 0);
    return concat([...localParts, centralDirectory, end]);
  }

  Object.defineProperty(globalThis, "FCI_SUPPORT_BUNDLE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 1,
      REDACTED,
      OMITTED,
      sanitizeUrl,
      sanitizeValue,
      bundleEntries,
      buildZip
    })
  });
})();
