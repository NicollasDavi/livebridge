import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRtmpPublishCredential,
  isAbrVariantPublishPath,
  isMainLivePublishPath,
  parseMediaMtxAuthBody,
  validateRtmpPublish
} from '../lib/rtmpPublishAuth.js';

describe('rtmpPublishAuth', () => {
  it('identifica paths ABR internos', () => {
    assert.equal(isAbrVariantPublishPath('live/matematica_720'), true);
    assert.equal(isAbrVariantPublishPath('live/matematica'), false);
  });

  it('identifica ingest principal OBS', () => {
    assert.equal(isMainLivePublishPath('live/matematica'), true);
    assert.equal(isMainLivePublishPath('live/matematica_480'), false);
    assert.equal(isMainLivePublishPath('other/x'), false);
  });

  it('extrai token do campo token do MediaMTX', () => {
    const cred = extractRtmpPublishCredential({ token: 'abc123', path: 'live/teste' });
    assert.equal(cred, 'abc123');
  });

  it('extrai token de query string', () => {
    const cred = extractRtmpPublishCredential({
      path: 'live/teste',
      query: 'token=secret-token'
    });
    assert.equal(cred, 'secret-token');
  });

  it('permite variantes ABR sem token', () => {
    const r = validateRtmpPublish(
      { action: 'publish', path: 'live/aula_720' },
      { allowedTokens: [], authRequired: true }
    );
    assert.equal(r.ok, true);
  });

  it('nega ingest principal sem token configurado (fail-closed)', () => {
    const r = validateRtmpPublish(
      { action: 'publish', path: 'live/aula' },
      { allowedTokens: [], authRequired: true }
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /RTMP_PUBLISH_TOKEN/);
  });

  it('nega ingest principal com token inválido', () => {
    const r = validateRtmpPublish(
      { action: 'publish', path: 'live/aula', token: 'wrong' },
      { allowedTokens: ['correct'], authRequired: true }
    );
    assert.equal(r.ok, false);
  });

  it('permite ingest principal com token válido', () => {
    const r = validateRtmpPublish(
      { action: 'publish', path: 'live/aula', token: 'my-publish-key' },
      { allowedTokens: ['my-publish-key'], authRequired: true }
    );
    assert.equal(r.ok, true);
  });

  it('parseia corpo JSON do MediaMTX', () => {
    const body = parseMediaMtxAuthBody(Buffer.from('{"action":"publish","path":"live/x"}'));
    assert.equal(body.action, 'publish');
    assert.equal(body.path, 'live/x');
  });
});
