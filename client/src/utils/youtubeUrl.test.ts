/**
 * Tests for client-side YouTube URL detection.
 *
 * Run (from client dir):
 *   npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectYouTubeUrl, isPlaylistImportUrl } from './youtubeUrl.js';

describe('detectYouTubeUrl – single_video', () => {
  it('standard watch URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(r.playlistId, null);
  });

  it('short youtu.be URL', () => {
    const r = detectYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });

  it('mobile m.youtube.com', () => {
    const r = detectYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });

  it('music.youtube.com', () => {
    const r = detectYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });

  it('embed URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });

  it('live URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/live/abc123xyz');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'abc123xyz');
  });

  it('shorts URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });

  it('watch URL with extra params (t=120s)', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s');
    assert.strictEqual(r.kind, 'single_video');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  });
});

describe('detectYouTubeUrl – playlist', () => {
  it('pure playlist URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.strictEqual(r.kind, 'playlist');
    assert.strictEqual(r.playlistId, 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.strictEqual(r.videoId, null);
  });

  it('music.youtube.com playlist', () => {
    const r = detectYouTubeUrl('https://music.youtube.com/playlist?list=PLmusic123');
    assert.strictEqual(r.kind, 'playlist');
    assert.strictEqual(r.playlistId, 'PLmusic123');
  });
});

describe('detectYouTubeUrl – video_with_playlist', () => {
  it('watch URL with both v= and list= params', () => {
    const r = detectYouTubeUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    );
    assert.strictEqual(r.kind, 'video_with_playlist');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(r.playlistId, 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
  });

  it('youtu.be short URL with list= param', () => {
    const r = detectYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?list=PLabc123');
    assert.strictEqual(r.kind, 'video_with_playlist');
    assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(r.playlistId, 'PLabc123');
  });
});

describe('detectYouTubeUrl – not_supported / invalid', () => {
  it('channel URL (@handle)', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/@SomeChannel');
    assert.strictEqual(r.kind, 'not_supported');
  });

  it('channel URL (/channel/...)', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/channel/UC123abc');
    assert.strictEqual(r.kind, 'not_supported');
  });

  it('user URL', () => {
    const r = detectYouTubeUrl('https://www.youtube.com/user/someuser');
    assert.strictEqual(r.kind, 'not_supported');
  });

  it('non-YouTube domain', () => {
    const r = detectYouTubeUrl('https://example.com/watch?v=abc');
    assert.strictEqual(r.kind, 'invalid');
  });

  it('empty string', () => {
    const r = detectYouTubeUrl('');
    assert.strictEqual(r.kind, 'invalid');
  });

  it('plain text (not a URL)', () => {
    const r = detectYouTubeUrl('not a url at all');
    assert.strictEqual(r.kind, 'invalid');
  });
});

describe('isPlaylistImportUrl', () => {
  it('returns true for pure playlist URL', () => {
    assert.strictEqual(
      isPlaylistImportUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'),
      true,
    );
  });

  it('returns true for video_with_playlist URL', () => {
    assert.strictEqual(
      isPlaylistImportUrl('https://www.youtube.com/watch?v=abc123&list=PLabc'),
      true,
    );
  });

  it('returns false for single video URL', () => {
    assert.strictEqual(
      isPlaylistImportUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      false,
    );
  });

  it('returns false for invalid URL', () => {
    assert.strictEqual(isPlaylistImportUrl('not a url'), false);
  });

  it('returns false for channel URL', () => {
    assert.strictEqual(isPlaylistImportUrl('https://www.youtube.com/@Channel'), false);
  });
});
