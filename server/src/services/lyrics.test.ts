/**
 * Tests for lyrics service — VTT parser and helpers.
 *
 * Run:
 *   node --import tsx --test src/services/lyrics.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVttToPlainText } from './lyrics';

describe('parseVttToPlainText', () => {
  it('extracts text lines from VTT content', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:04.000
Hello world

00:00:04.000 --> 00:00:08.000
This is a test

00:00:08.000 --> 00:00:12.000
Of the lyrics parser
`;
    const result = parseVttToPlainText(vtt);
    assert.ok(result);
    assert.ok(result.includes('Hello world'));
    assert.ok(result.includes('This is a test'));
    assert.ok(result.includes('Of the lyrics parser'));
  });

  it('deduplicates repeated lines', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Repeated line

00:00:04.000 --> 00:00:08.000
Repeated line

00:00:08.000 --> 00:00:12.000
Unique line

00:00:12.000 --> 00:00:16.000
Another unique
`;
    const result = parseVttToPlainText(vtt);
    assert.ok(result);
    const lines = result.split('\n');
    const repeatedCount = lines.filter(l => l === 'Repeated line').length;
    assert.equal(repeatedCount, 1, 'Repeated line should appear only once');
  });

  it('strips HTML tags from subtitle text', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<c>Tagged</c> <00:00:02.000>text

00:00:04.000 --> 00:00:08.000
Normal line one

00:00:08.000 --> 00:00:12.000
Normal line two
`;
    const result = parseVttToPlainText(vtt);
    assert.ok(result);
    assert.ok(result.includes('Tagged text'));
    assert.ok(!result.includes('<c>'));
  });

  it('returns null for too few lines (not lyrics)', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Just one line
`;
    const result = parseVttToPlainText(vtt);
    assert.equal(result, null, 'Should return null for < 3 text lines');
  });

  it('skips VTT header lines, timestamps, and metadata', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en
NOTE This is a comment

1
00:00:01.000 --> 00:00:04.000
Line one

2
00:00:04.000 --> 00:00:08.000
Line two

3
00:00:08.000 --> 00:00:12.000
Line three
`;
    const result = parseVttToPlainText(vtt);
    assert.ok(result);
    // Should not contain any metadata
    assert.ok(!result.includes('WEBVTT'));
    assert.ok(!result.includes('Kind:'));
    assert.ok(!result.includes('NOTE'));
    assert.ok(!result.includes('00:00:'));
    // Should contain the text
    const lines = result.split('\n');
    assert.deepEqual(lines, ['Line one', 'Line two', 'Line three']);
  });

  it('handles &amp; entity decoding', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Rock &amp; Roll

00:00:04.000 --> 00:00:08.000
Tom &amp; Jerry

00:00:08.000 --> 00:00:12.000
The End
`;
    const result = parseVttToPlainText(vtt);
    assert.ok(result);
    assert.ok(result.includes('Rock & Roll'));
    assert.ok(result.includes('Tom & Jerry'));
  });
});
