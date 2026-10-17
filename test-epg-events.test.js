import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventChannels, epgStartTime } from './lib/flix-epg.js';
import { attachNblEpgSources, attachPenguNblSources, buildEpgEvents } from './lib/stremio.js';

test('non-Next event labels are parsed, classified, and grouped as NBL', () => {
  const xml = `<?xml version="1.0"?><tv>
    <channel id="nbl-dream"><display-name>EL TV 007| Sydney Kings vs Perth Wildcats (2026-10-17 08:30:00)</display-name></channel>
    <channel id="nbl-strong"><display-name>Event Channel 2 | Sydney Kings vs Perth Wildcats (2026-10-17 08:30:00)</display-name></channel>
    <channel id="ordinary"><display-name>ESPN Live Sports</display-name></channel>
    <channel id="golf-channel"><display-name>GOLF CHANNEL FHD</display-name></channel>
    <programme start="20261017080000 +0000" stop="20261017120000 +0000" channel="nbl-dream"><title>Sydney Kings vs Perth Wildcats</title><desc>Live event channel</desc></programme>
    <programme start="20261017080000 +0000" stop="20261017120000 +0000" channel="nbl-strong"><title>Sydney Kings vs Perth Wildcats</title><desc>Live event channel</desc></programme>
    <programme start="20261017080000 +0000" stop="20261017120000 +0000" channel="golf-channel"><title>GOLF CHANNEL FHD</title><desc>Sports channel</desc></programme>
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

test('upcoming ESPN NBL fixtures stay in the catalog without a catalog match and attach only explicit EPG matchups', () => {
  const now = Date.parse('2026-10-17T11:00:00Z');
  const fixture = {
    id: 'espn:nbl:20261018:401875281', type: 'tv', name: 'New Zealand Breakers at Tasmania JackJumpers',
    _league: 'nbl', _eventId: '401875281', _start: '2026-10-18T04:00:00.000Z', _state: 'upcoming',
    _competition: { competitors: [
      { team: { displayName: 'Tasmania JackJumpers', shortDisplayName: 'JackJumpers', name: 'JackJumpers', nickname: 'JackJumpers', abbreviation: 'TAS' } },
      { team: { displayName: 'New Zealand Breakers', shortDisplayName: 'Breakers', name: 'Breakers', nickname: 'Breakers', abbreviation: 'NZB' } },
    ] },
    _sourceIds: [], _sourceNames: [],
  };
  const channels = [
    { id: 'matched', source: 'dream', label: 'EL TV 007 | New Zealand Breakers vs Tasmania JackJumpers (2026-10-18 04:00:00)', programmes: [{ start: now, stop: now + 6 * 60 * 60_000, title: 'Live event' }] },
    { id: 'generic', source: 'trex', label: 'EL TV 025 | Basketball Live', programmes: [{ start: now, stop: now + 6 * 60 * 60_000, title: 'Sports broadcast' }] },
    { id: 'wrong-game', source: 'strong', label: 'EL TV 026 | Sydney Kings vs Perth Wildcats (2026-10-18 04:00:00)', programmes: [{ start: now, stop: now + 6 * 60 * 60_000, title: 'Live event' }] },
  ];
  const result = attachNblEpgSources([fixture], channels, now);
  assert.equal(result.length, 1, 'ESPN fixture remains available even when no Flix catalog entry exists');
  assert.equal(result[0]._sourceIds.length, 1, 'only the explicit correct matchup is attached');
  assert.match(result[0]._sourceIds[0], /flixlivetvtest:dream:matched/);
  assert.equal(result[0]._epgMatchCount, 1);
});

test('PenguPlay NBL upcoming entries attach only when teams, Sydney date, and kickoff match ESPN', () => {
  const event = {
    id: 'espn:nbl:20261018:401875281', name: 'New Zealand Breakers at Tasmania JackJumpers',
    _league: 'nbl', _start: '2026-10-18T04:00:00.000Z', _sourceIds: [], _sourceNames: [],
    _competition: { competitors: [
      { team: { displayName: 'Tasmania JackJumpers', shortDisplayName: 'JackJumpers', name: 'JackJumpers', nickname: 'JackJumpers', abbreviation: 'TAS' } },
      { team: { displayName: 'New Zealand Breakers', shortDisplayName: 'Breakers', name: 'Breakers', nickname: 'Breakers', abbreviation: 'NZB' } },
    ] },
  };
  const correct = { id: 'pp-live:timstreams~tasmania-jackjumpers-vs-new-zealand-breakers-30546', name: '⏱️ Tasmania JackJumpers vs. New Zealand Breakers', description: 'Basketball\n⏱️ Starts Oct 18, 15:00\nKickoff: Oct 18, 15:00\n🛰️ Sources: TimStreams, Streamed.pk, PPV.st', genres: ['🏀 Basketball'] };
  const wrongDate = { ...correct, id: 'pp-live:wrong-date', description: 'Basketball\n⏱️ Starts Oct 19, 15:00\nKickoff: Oct 19, 15:00' };
  const wrongFixture = { ...correct, id: 'pp-live:wrong-fixture', name: 'Sydney Kings vs Perth Wildcats' };
  const result = attachPenguNblSources([event], [wrongDate, wrongFixture, correct]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]._sourceIds, [correct.id]);
  assert.equal(result[0]._penguMatch, true);
});


test('EPG catalogs include college football, darts, CFL and wrestling only within 24 hours', () => {
  const now = Date.parse('2026-10-17T00:00:00Z');
  const channels = [
    { id: 'college', source: 'dream', label: 'Alabama Crimson Tide vs Tennessee Volunteers', programmes: [{ start: now, stop: now + 4 * 60 * 60_000, title: 'Football' }] },
    { id: 'cfl', source: 'dream', label: 'Montreal Alouettes vs Saskatchewan Roughriders', programmes: [{ start: now, stop: now + 4 * 60 * 60_000, title: 'Live event' }] },
    { id: 'darts', source: 'dream', label: 'Dutch Darts Championship Day 2 Afternoon Session', programmes: [{ start: now, stop: now + 4 * 60 * 60_000, title: 'Dutch Darts Championship' }] },
    { id: 'wrestling', source: 'dream', label: 'AEW Saturday Night Collision', programmes: [{ start: now, stop: now + 3 * 60 * 60_000, title: 'AEW Wrestling' }] },
    { id: 'tomorrow', source: 'dream', label: 'Dallas Cowboys vs Philadelphia Eagles', programmes: [{ start: now + 25 * 60 * 60_000, stop: now + 29 * 60 * 60_000, title: 'NFL Football' }] },
  ];
  const collegeFixture = { _league: 'ncaaf', name: 'Alabama Crimson Tide at Tennessee Volunteers', _start: new Date(now).toISOString(), _competition: { competitors: [
    { team: { displayName: 'Alabama Crimson Tide' } }, { team: { displayName: 'Tennessee Volunteers' } },
  ] } };
  const events = buildEpgEvents('https://example.test', { channels, end: now + 30 * 60 * 60_000 }, [collegeFixture], now);
  assert.deepEqual(new Set(events.map(event => event._league)), new Set(['ncaaf', 'cfl', 'darts', 'wrestling']));
  assert.equal(events.some(event => event._sourceIds.includes('flixlivetvtest:dream:tomorrow')), false);
});
