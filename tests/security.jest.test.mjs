import { createHash } from 'node:crypto';
test('SHA-256 has stable 64-char output', () => {
  expect(createHash('sha256').update('nexverse').digest('hex')).toHaveLength(64);
});
