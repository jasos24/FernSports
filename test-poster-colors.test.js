import test from 'node:test';
import assert from 'node:assert/strict';
import { complementaryPosterColor } from './lib/poster-image.js';

test('dark blue team artwork gets a warm complementary poster background', () => {
  const color = complementaryPosterColor('#002868');
  const [r, g, b] = color.slice(1).match(/.{2}/g).map(value => parseInt(value, 16));
  assert.ok(r > g && g > b, `${color} should be a warm orange for navy artwork`);
});

test('red team artwork gets a teal complementary poster background', () => {
  const color = complementaryPosterColor('#cc0000');
  const [r, g, b] = color.slice(1).match(/.{2}/g).map(value => parseInt(value, 16));
  assert.ok(g > r && b > r, `${color} should be teal for red artwork`);
});
