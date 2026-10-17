import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStream } from './lib/stremio.js';

test('stream labels sort into the four requested tiers', () => {
  const cases = [
    [{ name: 'US: ESPN' }, { rank: 0, tier: 'ENGLISH TV' }],
    [{ name: 'AU: Fox Sports' }, { rank: 0, tier: 'ENGLISH TV' }],
    [{ name: 'ESPN' }, { rank: 100, tier: 'OTHER TV' }],
    [{ name: 'UK: Sky Sports' }, { rank: 0, tier: 'ENGLISH TV' }],
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
