import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStream, isAlwaysOnStream } from './lib/stremio.js';

test('stream labels sort into the four requested tiers', () => {
  const cases = [
    [{ name: 'EN: ESPN' }, { rank: 0, tier: 'ENGLISH TV' }],
    [{ name: 'AU: Fox Sports' }, { rank: 0, tier: 'ENGLISH TV' }],
    [{ name: 'ESPN' }, { rank: 100, tier: 'OTHER TV' }],
    [{ name: 'PRIME| TSN 5 RAW · LIVE' }, { rank: 0, tier: 'ENGLISH TV' }],
    [{ name: 'Sky Sports', title: 'Event\\nSky Sports' }, { rank: 100, tier: 'OTHER TV' }],
    [{ name: 'Event PPV' }, { rank: 200, tier: 'EVENT-SPECIFIC PPV' }],
    [{ name: 'Unknown source' }, { rank: 300, tier: 'UNKNOWN' }],
    [{ name: 'Prime Video' }, { rank: 300, tier: 'UNKNOWN' }],
  ];
  for (const [stream, expected] of cases) assert.deepEqual(classifyStream(stream), expected, stream.name);
});

test('all tiers sort in the requested priority order', () => {
  const labels = ['US: ESPN', 'ESPN', 'Event PPV', 'Unknown stream'];
  const sorted = labels.map(name => ({ name, ...classifyStream({ name }) })).sort((a,b) => a.rank - b.rank);
  assert.deepEqual(sorted.map(x => x.tier), ['ENGLISH TV', 'OTHER TV', 'EVENT-SPECIFIC PPV', 'UNKNOWN']);
});


test('continuous 24/7 channel streams are excluded from event listings', () => {
  assert.equal(isAlwaysOnStream({ name: '24/7 NFL Network' }), true);
  assert.equal(isAlwaysOnStream({ title: 'Channel\\nRound-the-clock sports' }), true);
  assert.equal(isAlwaysOnStream({ name: 'ESPN live event broadcast' }), false);
});
