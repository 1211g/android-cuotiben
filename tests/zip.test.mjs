// Pure-function tests for js/zip.js (IIFE attaching to window).
// node:test + node:assert; the window shim lets the browser IIFE load in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'js', 'zip.js'), 'utf8');
globalThis.window = globalThis; // minimal browser shim
vm.runInThisContext(source, { filename: 'js/zip.js' });
const Zip = globalThis.window.Zip;

test('Zip API is exposed on window', () => {
  assert.ok(Zip, 'window.Zip should be defined');
  assert.equal(typeof Zip.crc32, 'function');
  assert.equal(typeof Zip.createZip, 'function');
  assert.equal(typeof Zip.readZip, 'function');
});

test('crc32 matches the standard check value for "123456789"', () => {
  assert.equal(Zip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('crc32 of empty input is 0', () => {
  assert.equal(Zip.crc32(new Uint8Array(0)), 0);
});

test('crc32 distinguishes inputs differing by one byte', () => {
  const enc = new TextEncoder();
  assert.notEqual(Zip.crc32(enc.encode('hello')), Zip.crc32(enc.encode('Hello')));
});

test('createZip -> readZip round-trip preserves name, bytes and JSON', async () => {
  const text = '{"hello":"world","n":42}';
  const blob = Zip.createZip([{ name: 'data.json', data: Zip.strBytes(text) }]);
  assert.equal(blob.type, 'application/zip');
  const entries = await Zip.readZip(await blob.arrayBuffer());
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'data.json');
  assert.equal(entries[0].text(), text);
  assert.deepEqual(entries[0].json(), { hello: 'world', n: 42 });
});

test('createZip round-trips multiple files with UTF-8 filenames', async () => {
  const blob = Zip.createZip([
    { name: 'data.json', data: Zip.jsonBytes({ a: 1 }) },
    { name: 'images/图1.txt', data: Zip.strBytes('你好') }
  ]);
  const entries = await Zip.readZip(await blob.arrayBuffer());
  assert.deepEqual(entries.map(e => e.name), ['data.json', 'images/图1.txt']);
  assert.deepEqual(entries[0].json(), { a: 1 });
  assert.equal(entries[1].text(), '你好');
});

test('readZip rejects a buffer that is not a ZIP archive', async () => {
  await assert.rejects(
    () => Zip.readZip(new TextEncoder().encode('not a zip file').buffer),
    /不是有效的 ZIP 备份包/
  );
});
