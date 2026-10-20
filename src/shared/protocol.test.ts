import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBytes, parseHex, setBrightness, setColor, toHex } from './protocol.ts';

test('setColor matches the documented frame', () => {
  assert.equal(toHex(setColor({ r: 255, g: 0, b: 128 })), '7E 07 05 03 FF 00 80 10 EF');
});

test('setColor clamps and rounds', () => {
  assert.equal(toHex(setColor({ r: 300, g: -5, b: 12.6 })), '7E 07 05 03 FF 00 0D 10 EF');
});

test('setBrightness matches the documented frame and clamps to 100', () => {
  assert.equal(toHex(setBrightness(50)), '7E 04 01 32 01 FF FF 00 EF');
  assert.equal(toHex(setBrightness(250)), '7E 04 01 64 01 FF FF 00 EF');
});

test('parsers', () => {
  assert.deepEqual(parseHex('#ff8800'), { r: 255, g: 136, b: 0 });
  assert.equal(toHex(parseBytes('0x7e 07:05-03')), '7E 07 05 03');
  assert.throws(() => parseBytes('7e0'));
});
