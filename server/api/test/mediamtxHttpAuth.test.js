import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDockerInternalIp } from '../routes/mediamtxHttpAuth.js';

describe('isDockerInternalIp', () => {
  it('aceita loopback e redes Docker', () => {
    assert.equal(isDockerInternalIp('127.0.0.1'), true);
    assert.equal(isDockerInternalIp('::ffff:172.18.0.2'), true);
    assert.equal(isDockerInternalIp('10.0.0.5'), true);
  });

  it('rejeita IP externo', () => {
    assert.equal(isDockerInternalIp('8.8.8.8'), false);
  });
});
