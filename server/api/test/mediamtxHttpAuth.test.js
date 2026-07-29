import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('isDockerInternalIp', () => {
  let isDockerInternalIp;

  before(async () => {
    // Import dinâmico evita carregar config/env cedo demais via dependências do módulo.
    ({ isDockerInternalIp } = await import('../routes/mediamtxHttpAuth.js'));
  });

  it('aceita loopback e redes Docker', () => {
    assert.equal(isDockerInternalIp('127.0.0.1'), true);
    assert.equal(isDockerInternalIp('::ffff:172.18.0.2'), true);
    assert.equal(isDockerInternalIp('10.0.0.5'), true);
  });

  it('rejeita IP externo', () => {
    assert.equal(isDockerInternalIp('8.8.8.8'), false);
  });
});
