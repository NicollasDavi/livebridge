import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'test-video-access-secret-for-unit-tests';

describe('jwtLive', () => {
  let signVideoAccessToken;
  let verifyLiveToken;
  let verifyVideoToken;
  let liveTokenMatchesHlsStream;

  before(async () => {
    process.env.VIDEO_ACCESS_SECRET = SECRET;
    const mod = await import('../lib/jwtLive.js');
    signVideoAccessToken = mod.signVideoAccessToken;
    verifyLiveToken = mod.verifyLiveToken;
    verifyVideoToken = mod.verifyVideoToken;
    liveTokenMatchesHlsStream = mod.liveTokenMatchesHlsStream;
  });

  it('assina e valida token de gravação', () => {
    const token = signVideoAccessToken('live/matematica', '2026-03-10_16-33-50');
    assert.ok(token);
    const payload = verifyVideoToken(token);
    assert.equal(payload.path, 'live/matematica');
    assert.equal(payload.session, '2026-03-10_16-33-50');
  });

  it('rejeita token de gravação com path/session errados', () => {
    const token = signVideoAccessToken('live/a', 'sess1');
    const payload = verifyVideoToken(token);
    assert.notEqual(payload.path, 'live/b');
  });

  it('liveTokenMatchesHlsStream aceita variantes ABR', () => {
    const payload = { streamName: 'matematica' };
    assert.equal(liveTokenMatchesHlsStream(payload, 'matematica_720'), true);
    assert.equal(liveTokenMatchesHlsStream(payload, 'matematica'), true);
    assert.equal(liveTokenMatchesHlsStream(payload, 'outra'), false);
  });

  it('verifyLiveToken exige streamName', () => {
    assert.equal(verifyLiveToken(null), null);
  });
});
