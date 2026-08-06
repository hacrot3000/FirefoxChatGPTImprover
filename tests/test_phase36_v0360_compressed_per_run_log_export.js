"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

vm.runInThisContext(read("extension/shared/log_archive.js"), { filename: "log_archive.js" });

function readUint16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function extractLocalEntries(bytes) {
  const entries = new Map();
  let offset = 0;
  while (readUint32(bytes, offset) === 0x04034b50) {
    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const uncompressedSize = readUint32(bytes, offset + 22);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 8 ? new Uint8Array(zlib.inflateRawSync(compressed)) : compressed;
    assert.strictEqual(data.byteLength, uncompressedSize, `${name} uncompressed size`);
    entries.set(name, { method, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

(async () => {
  const Archive = globalThis.FCI_LOG_ARCHIVE;
  assert.strictEqual(Archive.VERSION, 1);
  const transcript = "stdout: repeated command output\n".repeat(2000);
  const metadata = JSON.stringify({ schema: "firefox-chat-assistant.command-run-archive", runId: "tab-7-run" }, null, 2) + "\n";
  const bytes = await Archive.buildZip([
    { name: "command.log", data: transcript },
    { name: "metadata.json", data: metadata },
    { name: "README.txt", data: "One command run.\n" }
  ], { modifiedAt: new Date("2026-08-06T04:00:00Z") });
  assert.strictEqual(readUint32(bytes, 0), 0x04034b50, "local ZIP header");
  assert.strictEqual(readUint32(bytes, bytes.byteLength - 22), 0x06054b50, "end of central directory");
  const entries = extractLocalEntries(bytes);
  assert.deepStrictEqual([...entries.keys()], ["command.log", "metadata.json", "README.txt"]);
  assert.strictEqual(new TextDecoder().decode(entries.get("command.log").data), transcript);
  assert.strictEqual(new TextDecoder().decode(entries.get("metadata.json").data), metadata);
  assert.strictEqual(entries.get("command.log").method, 8, "repetitive transcript must use DEFLATE");
  assert.strictEqual(Archive.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);

  const manifest = JSON.parse(read("extension/manifest.json"));
  const sidebar = read("extension/sidebar/sidebar.js");
  const html = read("extension/sidebar/sidebar.html");
  assert.ok(Number(manifest.version.split(".")[1]) >= 36, "compressed run-log export must remain available after v0.36.0");
  assert(html.includes('src="../shared/log_archive.js"'));
  assert(html.includes('id="exportShellLogArchiveButton"'));
  assert(sidebar.includes("async function readCompleteShellLog("));
  assert(sidebar.includes("async function exportShellLogArchive("));
  assert(sidebar.includes('type: MESSAGE.READ_SHELL_LOG'));
  assert(sidebar.includes('name: "command.log"'));
  assert(sidebar.includes('name: "metadata.json"'));
  assert(sidebar.includes('name: "README.txt"'));
  assert(sidebar.includes("LogArchive.buildZip"));
  assert(sidebar.includes("completeTranscript"));
  assert(sidebar.includes("persisted-fallback"));
  console.log("PASS: Phase 36 compressed per-run command-log ZIP export, complete paged transcript, metadata and fallback");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
