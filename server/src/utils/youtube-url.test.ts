import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectYouTubeUrlType,
  extractPlaylistId,
  extractVideoId,
  YouTubeUrlType,
} from './youtube-url.js';

describe('extractVideoId', () => {
  it('extracts video ID from standard youtube.com watch URL', () => {
    assert.strictEqual(
      extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('extracts video ID from short youtu.be URL', () => {
    assert.strictEqual(
      extractVideoId('https://youtu.be/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('extracts video ID from m.youtube.com URL', () => {
    assert.strictEqual(
      extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('extracts video ID from music.youtube.com URL', () => {
    assert.strictEqual(
      extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('extracts video ID with additional query params', () => {
    assert.strictEqual(
      extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s'),
      'dQw4w9WgXcQ'
    );
  });

  it('extracts video ID from live URL', () => {
    assert.strictEqual(
      extractVideoId('https://www.youtube.com/live/abc123xyz'),
      'abc123xyz'
    );
  });

  it('extracts video ID from embed URL', () => {
    assert.strictEqual(
      extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
  });

  it('returns null for non-YouTube URLs', () => {
    assert.strictEqual(extractVideoId('https://example.com/watch?v=abc'), null);
  });

  it('returns null for invalid URLs', () => {
    assert.strictEqual(extractVideoId('not a url'), null);
  });
});

describe('extractPlaylistId', () => {
  it('extracts playlist ID from standard URL', () => {
    assert.strictEqual(
      extractPlaylistId('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'),
      'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
    );
  });

  it('extracts playlist ID from watch URL with list param', () => {
    assert.strictEqual(
      extractPlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'),
      'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
    );
  });

  it('returns null for URL without playlist', () => {
    assert.strictEqual(
      extractPlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      null
    );
  });

  it('returns null for non-YouTube URLs', () => {
    assert.strictEqual(extractPlaylistId('https://example.com/playlist?list=abc'), null);
  });
});

describe('detectYouTubeUrlType', () => {
  it('detects single video URL (watch)', () => {
    const result = detectYouTubeUrlType('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(result.type, YouTubeUrlType.SINGLE_VIDEO);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(result.playlistId, null);
  });

  it('detects single video URL (short)', () => {
    const result = detectYouTubeUrlType('https://youtu.be/dQw4w9WgXcQ');
    assert.strictEqual(result.type, YouTubeUrlType.SINGLE_VIDEO);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
  });

  it('detects playlist URL', () => {
    const result = detectYouTubeUrlType('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.strictEqual(result.type, YouTubeUrlType.PLAYLIST);
    assert.strictEqual(result.playlistId, 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.strictEqual(result.videoId, null);
  });

  it('detects video with playlist URL (video takes precedence as playlist context)', () => {
    const result = detectYouTubeUrlType('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.strictEqual(result.type, YouTubeUrlType.VIDEO_WITH_PLAYLIST);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(result.playlistId, 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
  });

  it('detects channel URL as not_supported', () => {
    const result = detectYouTubeUrlType('https://www.youtube.com/@SomeChannel');
    assert.strictEqual(result.type, YouTubeUrlType.NOT_SUPPORTED);
  });

  it('detects user URL as not_supported', () => {
    const result = detectYouTubeUrlType('https://www.youtube.com/user/someuser');
    assert.strictEqual(result.type, YouTubeUrlType.NOT_SUPPORTED);
  });

  it('detects non-YouTube URL as invalid', () => {
    const result = detectYouTubeUrlType('https://example.com/watch?v=abc');
    assert.strictEqual(result.type, YouTubeUrlType.INVALID);
  });

  it('detects invalid URL string as invalid', () => {
    const result = detectYouTubeUrlType('not a url');
    assert.strictEqual(result.type, YouTubeUrlType.INVALID);
  });

  it('handles mobile URLs', () => {
    const result = detectYouTubeUrlType('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(result.type, YouTubeUrlType.SINGLE_VIDEO);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
  });

  it('handles music.youtube.com URLs', () => {
    const result = detectYouTubeUrlType('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(result.type, YouTubeUrlType.SINGLE_VIDEO);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
  });

  it('handles youtube-nocookie.com URLs', () => {
    const result = detectYouTubeUrlType('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    assert.strictEqual(result.type, YouTubeUrlType.SINGLE_VIDEO);
    assert.strictEqual(result.videoId, 'dQw4w9WgXcQ');
  });
});
