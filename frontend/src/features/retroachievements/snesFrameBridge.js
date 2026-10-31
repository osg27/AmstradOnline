// Shared by the SNES iframe and regression tests. One check after each native
// main-loop iteration, only when its frame counter advanced and play is active.
export function attachSnesFrames(module, achievements, isPaused) {
  if (!module?._ra_memory_data || !module?._ra_memory_size || !module?._get_current_frame_count) return false;
  let previous = module._get_current_frame_count();
  module.osgRAFrame = () => {
    const current = module._get_current_frame_count();
    const changed = current !== previous;
    previous = current;
    if (changed && !isPaused()) achievements?.frame();
  };
  return true;
}
