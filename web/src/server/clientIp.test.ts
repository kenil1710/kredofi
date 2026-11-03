import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFrom, ipKey, isIp, isPrivateIp, viaWorker } from './clientIp.ts';

const S = 'x'.repeat(40);
const h = (o: Record<string, string>) => new Headers(o);

test('Worker header trusted only with the right secret', () => {
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '104.16.0.1' }), S), '203.0.113.7');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': 'wrong', 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' }), S), 'direct');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' }), undefined), '198.51.100.2');
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': 'short', 'x-kredofi-client-ip': '203.0.113.7' }), 'short'), 'direct'); // weak secret: Worker header never trusted, XFF neither
  assert.equal(clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.2' }), S), 'direct');
});

test('Space address without the Worker secret: one shared bucket, headers never trusted', () => {
  const host = 'kenil1710-kredofi.hf.space';
  assert.equal(clientIpFrom(h({ host, 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }), S), 'direct');
  assert.equal(clientIpFrom(h({ host, 'x-kredofi-proxy': 'guess', 'x-kredofi-client-ip': '203.0.113.7' }), S), 'direct');
  assert.equal(clientIpFrom(h({ host, 'x-kredofi-proxy': S, 'x-kredofi-client-ip': '203.0.113.7' }), S), '203.0.113.7');
  assert.ok(viaWorker(h({ 'x-kredofi-proxy': S }), S) && !viaWorker(h({ 'x-kredofi-proxy': S + 'x' }), S) && !viaWorker(h({}), S));
});

test('secret set: any request without it is direct, whatever the Host (trailing dot, other names)', () => {
  for (const host of ['kenil1710-kredofi.hf.space.', 'KENIL1710-KREDOFI.HF.SPACE', 'evil.example', ''])
    assert.equal(clientIpFrom(h({ host, 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.8' }), S), 'direct');
});

test('local runs (no secret): forged left-hand X-Forwarded-For hops are ignored', () => {
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }), undefined), '198.51.100.9');
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9, 10.0.0.3' }), undefined), '198.51.100.9');
  assert.equal(clientIpFrom(h({ 'x-forwarded-for': 'garbage, 2001:db8::5' }), undefined), '2001:db8:0:0::/64');
  assert.equal(clientIpFrom(h({}), undefined), 'local');
});

test('IPv6 addresses from one /64 share a bucket (audit L2)', () => {
  const k = (ip: string) => clientIpFrom(h({ 'x-kredofi-proxy': S, 'x-kredofi-client-ip': ip }), S);
  assert.equal(k('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(k('2001:db8:1:2:ffff:1:2:3'), '2001:db8:1:2::/64');
  assert.equal(k('2001:0db8:0001:0002:0:0:0:9'), '2001:db8:1:2::/64');
  assert.notEqual(k('2001:db8:1:3::1'), k('2001:db8:1:2::1'));
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('fe80::'), 'fe80:0:0:0::/64');
  assert.equal(k('203.0.113.7'), '203.0.113.7');
});

test('ip helpers', () => {
  assert.ok(isIp('8.8.8.8') && isIp('2001:db8::1') && !isIp('999.1.1.1') && !isIp('abc'));
  assert.ok(isPrivateIp('10.1.2.3') && isPrivateIp('172.20.0.1') && isPrivateIp('100.64.0.1') && isPrivateIp('fd00::1') && !isPrivateIp('8.8.8.8'));
});
