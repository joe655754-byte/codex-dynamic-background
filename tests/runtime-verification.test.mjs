import assert from 'node:assert/strict';
import { didPlaybackAdvance } from '../skills/codex-dynamic-background/scripts/runtime/verification.mjs';

const previous = { paused: false, time: 1, frames: 60, presentedFrames: 58 };
assert.equal(didPlaybackAdvance(previous, { paused: false, time: 2, frames: 120, presentedFrames: 116 }), true);
// Decoder and media-clock motion with no actual displayed frame was the old false positive.
assert.equal(didPlaybackAdvance(previous, { paused: false, time: 2, frames: 120, presentedFrames: 58 }), false);
assert.equal(didPlaybackAdvance(previous, { paused: false, time: 2, frames: 120 }), false);
assert.equal(didPlaybackAdvance(previous, { paused: false, time: 1, frames: 120, presentedFrames: 116 }), false);
assert.equal(didPlaybackAdvance(previous, { paused: true, time: 2, frames: 120, presentedFrames: 116 }), false);
assert.equal(didPlaybackAdvance({ time: 29.9, frames: 1800, presentedFrames: 1795 }, { paused: false, time: .1, frames: 1812, presentedFrames: 1807 }), true);
console.log('Read-only verification requires media, decoder, and actually presented frames to advance, including across loop boundaries.');
