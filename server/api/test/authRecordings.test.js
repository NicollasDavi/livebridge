import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'test-video-access-secret-for-unit-tests';

describe('requireVideoAuth (JWT estrito)', () => {
  let requireVideoAuth;
  let signVideoAccessToken;

  before(async () => {
    process.env.VIDEO_ACCESS_SECRET = SECRET;
    const authMod = await import('../middleware/authRecordings.js');
    const jwtMod = await import('../lib/jwtLive.js');
    requireVideoAuth = authMod.requireVideoAuth;
    signVideoAccessToken = jwtMod.signVideoAccessToken;
  });

  function runAuth(query, cookies = {}) {
    const req = { query, cookies };
    let statusCode;
    let jsonBody;
    let nextCalled = false;
    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(body) {
        jsonBody = body;
        return res;
      }
    };
    const next = () => {
      nextCalled = true;
    };
    requireVideoAuth(req, res, next);
    return { statusCode, jsonBody, nextCalled };
  }

  it('permite com JWT válido', () => {
    const path = 'live/matematica';
    const session = '2026-03-10_16-33-50';
    const token = signVideoAccessToken(path, session);
    const r = runAuth({ path, session, token });
    assert.equal(r.nextCalled, true);
  });

  it('nega sem JWT mesmo com cookie genérico', () => {
    const r = runAuth(
      { path: 'live/matematica', session: '2026-03-10_16-33-50' },
      { vid_ctx: 'a'.repeat(48) }
    );
    assert.equal(r.nextCalled, false);
    assert.equal(r.statusCode, 403);
    assert.match(r.jsonBody.error, /JWT/);
  });

  it('nega JWT com path/session incorretos', () => {
    const token = signVideoAccessToken('live/a', 'sess1');
    const r = runAuth({ path: 'live/b', session: 'sess1', token });
    assert.equal(r.nextCalled, false);
    assert.equal(r.statusCode, 403);
  });
});
