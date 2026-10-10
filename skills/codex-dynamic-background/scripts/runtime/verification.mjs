// A running media clock or decoder alone does not prove that the user sees motion.
export function didPlaybackAdvance(previous, current) {
  return !current.paused && current.frames > previous.frames &&
    current.presentedFrames > previous.presentedFrames &&
    Math.abs(current.time - previous.time) > .001;
}
