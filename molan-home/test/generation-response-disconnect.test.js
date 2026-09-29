'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { attachResponseDisconnect } = require('../lib/generation/response-disconnect');

test('response disconnect callback fires once and dispose removes the listener', () => {
  const response = new EventEmitter();
  response.destroyed = false;
  let calls = 0;
  const disconnect = attachResponseDisconnect(response, () => { calls += 1; });
  response.emit('close');
  response.emit('close');
  assert.equal(disconnect.disconnected, true);
  assert.equal(calls, 1);
  disconnect.dispose();
  response.emit('close');
  assert.equal(calls, 1);
});

test('an already-destroyed response is treated as disconnected immediately', () => {
  const response = new EventEmitter();
  response.destroyed = true;
  let calls = 0;
  const disconnect = attachResponseDisconnect(response, () => { calls += 1; });
  assert.equal(disconnect.disconnected, true);
  assert.equal(calls, 1);
  disconnect.dispose();
});
