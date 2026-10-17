import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventChannels, epgStartTime } from './lib/flix-epg.js';
import { buildEpgEvents } from './lib/stremio.js';

test('non-Next event labels are parsed, classified, and grouped as NBL', () => {
  const xml = `<?xml version="1.0"?><tv>
    <channel id="nbl-dream"><display-name>EL TV 007| Sydney Kings vs Perth Wildcats (2026-10-17 08:30:00)</display-name></channel>
    <channel id="nbl-strong"><display-name>Event Channel 2 | Sydney Kings vs Perth Wildcats (2026-10-17 08:30:00)</display-name></channel>
    <channel id="ordinary"><display-name>ESPN Live Sports</display-name></channel>
    <programme start="20261017080000 +0000" stop="20261017120000 +0000" channel="nbl-dream"><title>Sydney Kings vs Perth Wildcats</title><desc>Live event channel</desc></programme>
    <programme start="20261017080000 +0000" stop="20261017120000 +0000" channel="nbl-strong"><title>Sydney Kings vs Perth Wildcats</title><desc>Live event channel</desc></programme>
  </tv>`;
  const channels = parseEventChannels(xml).map(channel => ({ ...channel, source: channel.id === 'nbl-dream' ? 'dream' : 'strong' }));
  assert.equal(channels.length, 2, 'ordinary sports channel labels should be ignored');

  const now = Date.parse('2026-10-17T08:00:00Z');
  const events = buildEpgEvents('https://example.test', { channels, end: Date.parse('2026-10-18T00:00:00Z') }, [], now);
  assert.equal(events.length, 1, 'duplicate providers should become one event card');
  assert.equal(events[0]._league, 'nbl');
  assert.equal(events[0].name, 'Sydney Kings vs Perth Wildcats');
  assert.equal(events[0]._state, 'upcoming');
  assert.equal(events[0]._sourceIds.length, 2);
  assert.equal(epgStartTime('EL TV 007| Sydney Kings vs Perth Wildcats (2026-10-17 08:30:00)', now), Date.parse('2026-10-17T08:30:00Z'));
});
