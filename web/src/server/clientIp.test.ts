import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFrom, isIp, isPrivateIp, viaWorker } from './clientIp.ts';

const S = 'x'.repeat(40);
const h = (o: Record<string, string>) => new Headers(o);

test('Worker header trusted only with the right secret', () => {
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '104.16.0.1' }), S), '203.0.113.7');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': 'wrong', 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' }), S), '198.51.100.2');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' }), undefined), '198.51.100.2');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': 'short', 'x-kredofi-client-ip': '203.0.113.7' }), 'short'), 'local'); // weak secret never trusted
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.2' }), S), '198.51.100.2');
});

test('Space address without the Worker secret: one shared bucket, headers never trusted', () => {
  const host = 'kenil1710-kredofi.hf.space';
  assert.equal(clientIpFrom(h({ host, 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }), S), 'direct');
  assert.equal(clientIpFrom(h({ host, 'x-kredofi-proxy': 'guess', 'x-kredofi-client-ip': '203.0.113.7' }), S), 'direct');
  assert.equal(clientIpFrom(h({ host, 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7' }), S), '203.0.113.7');
  assert.ok(viaWorker(h({ 'x-kredofi-proxy': S }), S) && !viaWorker(h({ 'x-kredofi-proxy': S + 'x' }), S) && !viaWorker(h({}), S));
});

test('local runs: forged left-hand X-Forwarded-For hops are ignored', () => {
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }), S), '198.51.100.9');
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9, 10.0.0.3' }), S), '198.51.100.9');
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': 'garbage, 2001:db8::5' }), S), '2001:db8::5');
  assert.equal(clientIpFrom(h({}), S), 'local');
});

test('ip helpers', () => {
  assert.ok(isIp('8.8.8.8') && isIp('2001:db8::1') && !isIp('999.1.1.1') && !isIp('abc'));
  assert.ok(isPrivateIp('10.1.2.3') && isPrivateIp('172.20.0.1') && isPrivateIp('100.64.0.1') && isPrivateIp('fd00::1') && !isPrivateIp('8.8.8.8'));
});
