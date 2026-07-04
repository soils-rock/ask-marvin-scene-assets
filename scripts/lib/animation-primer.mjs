/**
 * Animation Primer constants (docs/ANIMATION_PRIMER.md in ask-marvin).
 * Duplicated here so Image_Processing tools do not import ask-marvin app code.
 */

export const SCENE_CANVAS = { width: 1920, height: 1080 };

export const MARVIN_CANVAS = { width: 300, height: 700 };

export const CHARACTER_ASSET = {
  format: "png",
  animatedFormat: "gif",
  canvas: MARVIN_CANVAS,
  directories: ["marvin", "nora", "sonny", "guests"],
};

export const SCENE_LAYER_ASSET = {
  format: "webp",
  canvas: SCENE_CANVAS,
  directories: ["background", "foreground"],
};
