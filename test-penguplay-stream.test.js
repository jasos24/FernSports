import test from 'node:test';
import assert from 'node:assert/strict';

test('PenguPlay stream lookup uses configured provider base and filters non-stream links', async () => {
  process.env.PENGUPLAY_BASE_URL = 'https://pengu.example/authenticated-provider';
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async url => {
    requestedUrl = String(url);
    return Response.json({ streams: [
      { name: 'support', externalUrl: 'https://example.test/donate' },
      { name: 'provider stream', url: 'https://example.test/live.m3u8' },
    ] });
  };
  try {
    const { fetchPenguSourceStreams } = await import('./lib/stremio.js?penguplay-stream-test');
    const streams = await fetchPenguSourceStreams('pp-live:timstreams~fixture-123');
    assert.match(requestedUrl, /authenticated-provider\/stream\/tv\/pp-live%3Atimstreams~/);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].name, 'provider stream');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PENGUPLAY_BASE_URL;
  }
});
