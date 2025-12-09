import Viewpoint from "@arcgis/core/Viewpoint.js";
import Camera from "@arcgis/core/Camera.js";

import { animationConfig } from "./configAnimation.js";

/**
 * Maps slide data keys to their corresponding animation handler functions,
 * enabling dynamic choreography of viewpoint and time slider transitions.
 */
const choreographyHandlers = {
  viewpoint: interpolateViewpoint,
  timeSlider: interpolateTimeSlider,
  environment: interpolateEnvironment
};

/**
 * Executes animation handlers for each key (defined above) in the current slide,
 * passing shared context including progress and map state.
 * Used to animate transitions between slides during scroll events.
 */
export function scrollAnimation(slideCurrent, slideNext, progress, view, timeSlider) {
  const context = { slideCurrent, slideNext, progress, view, timeSlider };
  Object.keys(slideCurrent)
    .filter(key => typeof choreographyHandlers[key] === "function")
    .forEach(key => {
      try {
        choreographyHandlers[key](context);
      } catch (error) {
        console.error(`Error processing '${key}':`, error);
      }
    });
}

/**
 * Smoothly interpolates between two slide viewpoints based on progress (0–1),
 * generating a transitional camera view with updated rotation, scale, and geometry.
 * Applies the interpolated viewpoint to the view with animation.
 */
function interpolateViewpoint({ slideCurrent, slideNext, progress, view, timeSlider }) {
  // Support both 2D viewpoint interpolation and 3D camera interpolation.
  // Use goTo for programmatic navigation and respect animationConfig.mapFit.

  const currentViewpoint = slideCurrent?.viewpoint;
  const nextViewpoint = slideNext?.viewpoint;
  const currentCamera = slideCurrent?.viewpoint.camera;
  const nextCamera = slideNext?.viewpoint.camera;

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const u = easeInOut(Math.max(0, Math.min(1, progress)));
  const lerp = (a, b, t) => (a === undefined || b === undefined) ? (a ?? b) : a + (b - a) * t;

  // Detect if the view is 3D (SceneView) by presence of a camera property
  const is3DView = view && view.type === "3d";

  // If camera data is provided and we're in a 3D view, interpolate camera
  if (is3DView && (currentCamera || nextCamera)) {
    if (!currentCamera || !nextCamera) return; // require both for meaningful interpolation

    const interpolatedCamera = {
      position: {
        spatialReference: currentCamera.position.spatialReference || nextCamera.position.spatialReference,
        x: lerp(currentCamera.position.x, nextCamera.position.x, u),
        y: lerp(currentCamera.position.y, nextCamera.position.y, u),
        z: lerp(currentCamera.position.z, nextCamera.position.z, u),
      },
      heading: lerp(currentCamera.heading, nextCamera.heading, u),
      tilt: lerp(currentCamera.tilt, nextCamera.tilt, u),
    };

    const targetCamera = Camera.fromJSON(interpolatedCamera);
    // For slider-driven interpolation keep animations off for responsiveness
    view.goTo(targetCamera, { animate: false }).catch((error) => {
      console.error("Error setting interpolated camera:", error);
    });
    return;
  }

  // Otherwise handle viewpoint (2D or 3D Viewpoint)
  if (!currentViewpoint || !nextViewpoint || !currentViewpoint.targetGeometry || !nextViewpoint.targetGeometry) return;

  const viewpointJSON = {
    rotation: lerp(currentViewpoint.rotation, nextViewpoint.rotation, u),
    scale: lerp(currentViewpoint.scale, nextViewpoint.scale, u),
    targetGeometry: {
      spatialReference: currentViewpoint.targetGeometry.spatialReference || nextViewpoint.targetGeometry?.spatialReference,
      xmin: lerp(currentViewpoint.targetGeometry.xmin, nextViewpoint.targetGeometry.xmin, u),
      ymin: lerp(currentViewpoint.targetGeometry.ymin, nextViewpoint.targetGeometry.ymin, u),
      xmax: lerp(currentViewpoint.targetGeometry.xmax, nextViewpoint.targetGeometry.xmax, u),
      ymax: lerp(currentViewpoint.targetGeometry.ymax, nextViewpoint.targetGeometry.ymax, u),
    },
  };

  const targetViewpoint = Viewpoint.fromJSON(viewpointJSON);

  // Respect mapFit: when 'scale' is set, pass the full Viewpoint so scale+rotation apply.
  // When not using 'scale' we still want the rotation to take effect — pass an
  // object containing the geometry as `target` and include `rotation` so `goTo`
  // can apply orientation while fitting to the geometry/extent.
  const target = animationConfig.mapFit === "scale"
    ? targetViewpoint
    : {
        target: targetViewpoint.targetGeometry,
        rotation: targetViewpoint.rotation,
      };

  // Use goTo for continuous/slider-driven updates
  view.goTo(target, animationConfig.goToConfig).catch((error) => {
    console.error("Error setting interpolated viewpoint:", error);
  });
}

/**
 * Interpolates between two slide time ranges based on progress (0–1),
 * snapping the result to the nearest time step and clamping it within bounds.
 * Updates the timeSlider's extent to reflect the interpolated time and stops playback.
 */
function interpolateTimeSlider({ slideCurrent, slideNext, progress, view, timeSlider }) {
  try {
  const slideTimeData = slideCurrent.timeSlider
  const start = new Date(slideTimeData.timeSliderStart);
  const end = new Date(slideTimeData.timeSliderEnd);
  const step = slideTimeData.timeSliderStep;
  const unit = slideTimeData.timeSliderUnit;
  const interpolate = (fromVal, toVal) => fromVal + (toVal - fromVal) * progress;
  const interpolatedTime = interpolate(start.getTime(), end.getTime());
  const unitToMs = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000, // Approximate
    years: 365 * 24 * 60 * 60 * 1000, // Approximate
  };

  const stepMs = step * (unitToMs[unit] || 0);
  if (stepMs <= 0) return new Date(Math.min(interpolatedTime, end.getTime()));

  // Snap to step
  const offset = interpolatedTime - start.getTime();
  const snappedOffset = Math.ceil(offset / stepMs) * stepMs;
  const snappedTime = start.getTime() + snappedOffset;

  // Clamp to end
  const clampedTime = Math.min(
    Math.max(snappedTime, start.getTime()),
    end.getTime()
  );
  timeSlider.timeExtent = {
    start: null,
    end: new Date(clampedTime),
  };
  timeSlider.stop();
  } catch (error) {
    console.error("Error setting time slider:", error);
  }

}

/**
 * Interpolates between two environment states based on progress (0–1),
 * and applies the resulting environment to the scene view.
 */
function interpolateEnvironment({ slideCurrent, slideNext, progress, view, timeSlider }) {
  const currentEnv = slideCurrent.environment;
  const nextEnv = slideNext?.environment;
  const interpolate = (fromVal, toVal) => fromVal + (toVal - fromVal) * progress;

  if (!currentEnv || !nextEnv) return;

  // Interpolate datetime and cloud cover
  const startLighting = new Date(currentEnv.lighting.datetime)
  const endLighting = new Date(nextEnv.lighting.datetime)
  const interpolatedLighting = interpolate(
    startLighting.getTime(),
    endLighting.getTime()
  );

  // Only interpolate numeric weather properties if both current and next values are present
  let interpolatedCloudCover = currentEnv.weather.cloudCover;
  if (
    currentEnv.weather && nextEnv.weather &&
    currentEnv.weather.cloudCover !== undefined && nextEnv.weather.cloudCover !== undefined
  ) {
    const c0 = Number(currentEnv.weather.cloudCover);
    const c1 = Number(nextEnv.weather.cloudCover);
    if (!Number.isNaN(c0) && !Number.isNaN(c1)) {
      interpolatedCloudCover = interpolate(c0, c1);
    }
  }

  let interpolatedPrecipitation = currentEnv.weather.precipitation;
  if (
    currentEnv.weather && nextEnv.weather &&
    currentEnv.weather.precipitation !== undefined && nextEnv.weather.precipitation !== undefined
  ) {
    const p0 = Number(currentEnv.weather.precipitation);
    const p1 = Number(nextEnv.weather.precipitation);
    if (!Number.isNaN(p0) && !Number.isNaN(p1)) {
      interpolatedPrecipitation = interpolate(p0, p1);
    }
  }

  // Toggle lighting and weather types from next slide
  const lightingType = nextEnv.lighting.type;
  const weatherType = nextEnv.weather.type;

  // Apply to view.environment
  view.environment = {
    lighting: {
      type: lightingType,
      date: new Date(interpolatedLighting),
      displayUTCOffset: nextEnv.lighting.displayUTCOffset,
    },
    atmosphereEnabled: currentEnv.atmosphereEnabled,
    starsEnabled: currentEnv.starsEnabled,
    weather: {
      type: weatherType,
      cloudCover: interpolatedCloudCover,
      precipitation : interpolatedPrecipitation
    },
  };
}
