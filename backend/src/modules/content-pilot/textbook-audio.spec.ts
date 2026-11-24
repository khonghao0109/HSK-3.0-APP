import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUDIO_MAX_BYTES,
  checkAudioBytes,
  resolveAudioPath,
  shouldAttachAudio,
} from './textbook-audio';

describe('textbook audio (M2.13c)', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hsk-audio-root-'));
    outside = mkdtempSync(join(tmpdir(), 'hsk-audio-outside-'));
    mkdirSync(join(root, 'vocab', 'audio'), { recursive: true });
    writeFileSync(join(root, 'vocab', 'audio', 'a.mp3'), 'x');
    writeFileSync(join(outside, 'secret.mp3'), 'x');
    writeFileSync(
      join(root, 'vocab', 'audio', 'big.mp3'),
      Buffer.alloc(AUDIO_MAX_BYTES + 1),
    );
    symlinkSync(
      join(outside, 'secret.mp3'),
      join(root, 'vocab', 'audio', 'link.mp3'),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  describe('resolveAudioPath', () => {
    it('resolves a ref inside the seeddata root', () => {
      expect(
        resolveAudioPath(root, join(root, 'vocab'), 'audio/a.mp3'),
      ).toEqual({
        ok: true,
        path: join(realpathSync(root), 'vocab', 'audio', 'a.mp3'),
      });
    });

    it.each([
      ['a parent traversal', '../../etc/passwd.mp3'],
      ['an absolute path', '/etc/passwd.mp3'],
      ['a symlink leaving the root', 'audio/link.mp3'],
    ])('refuses %s', (_label, ref) => {
      expect(resolveAudioPath(root, join(root, 'vocab'), ref)).toEqual({
        ok: false,
        code: 'audio_path_outside_root',
      });
    });

    it('reports a missing file', () => {
      expect(
        resolveAudioPath(root, join(root, 'vocab'), 'audio/none.mp3'),
      ).toEqual({ ok: false, code: 'audio_missing' });
    });

    it('refuses an oversized file before reading it', () => {
      expect(
        resolveAudioPath(root, join(root, 'vocab'), 'audio/big.mp3'),
      ).toEqual({ ok: false, code: 'audio_too_large' });
    });

    it('refuses a non-mp3 extension', () => {
      expect(
        resolveAudioPath(root, join(root, 'vocab'), 'audio/a.wav'),
      ).toEqual({ ok: false, code: 'audio_not_mp3' });
    });
  });

  describe('checkAudioBytes', () => {
    it('accepts an ID3 or MPEG frame-sync mp3', () => {
      expect(checkAudioBytes(Buffer.from('ID3\u0004rest'))).toBeNull();
      expect(checkAudioBytes(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBeNull();
    });

    it.each<[string, Buffer, string]>([
      ['an empty file', Buffer.alloc(0), 'audio_empty'],
      ['a non-mp3 file', Buffer.from('RIFF0000WAVE'), 'audio_not_mp3'],
      [
        'a file over the limit',
        Buffer.concat([Buffer.from('ID3'), Buffer.alloc(AUDIO_MAX_BYTES)]),
        'audio_too_large',
      ],
    ])('refuses %s', (_label, bytes, code) => {
      expect(checkAudioBytes(bytes)).toBe(code);
    });
  });

  describe('shouldAttachAudio', () => {
    it('attaches only to a live Word without audio', () => {
      expect(shouldAttachAudio({ audioId: null, deletedAt: null })).toBe(true);
      expect(shouldAttachAudio({ audioId: 7, deletedAt: null })).toBe(false);
      expect(
        shouldAttachAudio({ audioId: null, deletedAt: new Date('2026-11-24') }),
      ).toBe(false);
    });
  });
});
