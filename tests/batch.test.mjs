// Pure-function tests for js/batch.js (IIFE attaching to window).
// jest-free: node:test + node:assert only. The tiny shim below lets the
// browser-targeted IIFE run under Node without touching the source file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'js', 'batch.js'), 'utf8');
globalThis.window = globalThis; // minimal browser shim
vm.runInThisContext(source, { filename: 'js/batch.js' });
const Batch = globalThis.window.Batch;

test('Batch API is exposed on window', () => {
  assert.ok(Batch, 'window.Batch should be defined');
  assert.equal(Batch.FORMAT, 'cuotiben-batch');
  assert.equal(Batch.VERSION, 1);
  assert.equal(Batch.MAX_ITEMS, 5000);
});

test('parse: minimal valid cuotiben-batch JSON returns 1 record', () => {
  const input = JSON.stringify({
    format: 'cuotiben-batch',
    version: 1,
    questions: [{ stem: '1+1=?', correctAnswer: '2' }]
  });
  const out = Batch.parse(input);
  assert.equal(out.error, null);
  assert.equal(out.format, 'json');
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].stem, '1+1=?');
  assert.equal(out.items[0].correctAnswer, '2');
  assert.equal(out.items[0].subject, '未分类');
  assert.equal(out.items[0].qtype, '单选');
  assert.equal(out.items[0].difficulty, 3);
  assert.equal(out.items[0].mastery, 'unmastered');
  assert.equal(out.skipped, 0);
});

test('parse: rejects a foreign format with an error and no records', () => {
  const out = Batch.parse(JSON.stringify({
    format: 'something-else', version: 1, questions: [{ stem: 'x' }]
  }));
  assert.match(out.error, /这不是批量导入文件/);
  assert.equal(out.items.length, 0);
});

test('parse: CSV with header + one row normalizes into 1 record', () => {
  const csv = '题干,正确答案,难度\n"2+2=?",4,5\n';
  const out = Batch.parse(csv);
  assert.equal(out.error, null);
  assert.equal(out.format, 'csv');
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].stem, '2+2=?');
  assert.equal(out.items[0].correctAnswer, '4');
  assert.equal(out.items[0].difficulty, 5);
});

test('keyOf maps both English and Chinese aliases case-insensitively', () => {
  assert.equal(Batch.keyOf('外部ID'), 'externalId');
  assert.equal(Batch.keyOf('题干'), 'stem');
  assert.equal(Batch.keyOf('Correct Answer'), 'correctAnswer');
  assert.equal(Batch.keyOf('not-a-known-field'), null);
});

test('jsonTemplate output parses back into exactly one valid record', () => {
  const out = Batch.parse(Batch.jsonTemplate());
  assert.equal(out.error, null);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].correctAnswer, 'B');
  assert.deepEqual(out.items[0].tags, ['月考', '压轴题']);
});
