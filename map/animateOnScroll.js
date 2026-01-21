/*

Copyright 2026 Esri

Licensed under the Apache License Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

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
 * Derives a viewpoint object from a 3D camera for interpolation purposes.
 */
function deriveViewpointFromCamera(camera) {
  if (!camera || !camera.position) return null;

  // Approximate scale from z (higher z = smaller scale, roughly)
  const scale = camera.position.z > 0 ? 100000 / camera.position.z : 100000;

  // Approximate extent around the position
  const delta = 1000; // arbitrary extent size
  const centerX = camera.position.x;
  const centerY = camera.position.y;

  return {
    rotation: camera.heading || 0,
    scale: scale,
    targetGeometry: {
      xmin: centerX - delta,
      ymin: centerY - delta,
      xmax: centerX + delta,
      ymax: centerY + delta,
      spatialReference: camera.position.spatialReference
    }
  };
}

/**
 * Interpolates between two camera objects, handling tilt based on transition type.
 */
function interpolateCamera(derivedCurrent, derivedNext, currentCamera, nextCamera, u, lerp) {
  let tilt;
  if (!currentCamera && nextCamera) {
    // 2D to 3D: interpolate from 0 to assigned tilt
    tilt = lerp(0, derivedNext.tilt, u);
  } else if (currentCamera && !nextCamera) {
    // 3D to 2D: interpolate from assigned tilt to 0
    tilt = lerp(derivedCurrent.tilt, 0, u);
  } else {
    // Both 3D or both 2D: normal interpolation
    tilt = lerp(derivedCurrent.tilt, derivedNext.tilt, u);
  }

  return {
    position: {
      spatialReference: derivedCurrent.position.spatialReference || derivedNext.position.spatialReference,
      x: lerp(derivedCurrent.position.x, derivedNext.position.x, u),
      y: lerp(derivedCurrent.position.y, derivedNext.position.y, u),
      z: lerp(derivedCurrent.position.z, derivedNext.position.z, u),
    },
    heading: lerp(derivedCurrent.heading, derivedNext.heading, u),
    tilt: tilt,
  };
}

/**
 * Interpolates between two 2D viewpoints.
 */
function interpolate2DViewpoint(currentViewpoint, nextViewpoint, u, lerp) {
  if (!currentViewpoint || !nextViewpoint || !currentViewpoint.targetGeometry || !nextViewpoint.targetGeometry) return null;

  const viewpointJSON = {
    rotation: lerp(currentViewpoint.rotation, nextViewpoint.rotation, u),
    scale: lerp(currentViewpoint.scale, nextViewpoint.scale, u),
    targetGeometry: {
      spatialReference: currentViewpoint.targetGeometry.spatialReference || nextViewpoint.targetGeometry.spatialReference,
      xmin: lerp(currentViewpoint.targetGeometry.xmin, nextViewpoint.targetGeometry.xmin, u),
      ymin: lerp(currentViewpoint.targetGeometry.ymin, nextViewpoint.targetGeometry.ymin, u),
      xmax: lerp(currentViewpoint.targetGeometry.xmax, nextViewpoint.targetGeometry.xmax, u),
      ymax: lerp(currentViewpoint.targetGeometry.ymax, nextViewpoint.targetGeometry.ymax, u),
    },
  };

  return Viewpoint.fromJSON(viewpointJSON);
}
function interpolateViewpoint({ slideCurrent, slideNext, progress, view, timeSlider }) {
  // Support both 2D viewpoint interpolation and 3D camera interpolation.
  // Use goTo for programmatic navigation and respect animationConfig.mapFit.
  const currentViewpoint = slideCurrent?.viewpoint;
  const nextViewpoint = slideNext?.viewpoint;
  const currentCamera = slideCurrent?.viewpoint.camera;
  const nextCamera = slideNext?.viewpoint.camera;
  const u = progress;
  const lerp = (a, b, t) => (a === undefined || b === undefined) ? (a ?? b) : a + (b - a) * t;

  // Detect if the view is 3D (SceneView)
  const is3DView = view && view.type === "3d";

  // If transitioning to a 2D slide in a 3D view, interpolate viewpoints to account for scale
  if (is3DView && nextViewpoint && nextViewpoint.targetGeometry) {
    let derivedCurrentViewpoint = currentViewpoint;
    if (!derivedCurrentViewpoint || !derivedCurrentViewpoint.targetGeometry) {
      derivedCurrentViewpoint = currentCamera ? deriveViewpointFromCamera(currentCamera) : currentViewpoint;
    }

    const targetViewpoint = interpolate2DViewpoint(derivedCurrentViewpoint, nextViewpoint, u, lerp);
    if (targetViewpoint) {
      // Respect mapFit for 3D view
      const target = animationConfig.mapFit === "scale"
        ? targetViewpoint
        : {
            target: targetViewpoint.targetGeometry,
            rotation: targetViewpoint.rotation,
          };
      view.goTo(target, { animate: false }).catch((error) => {
        // Ignore AbortError - it's expected when rapid scroll events trigger new goTo calls
        if (error.name !== "AbortError") {
          console.error("Error setting interpolated viewpoint:", error);
        }
      });
      return;
    }
  }

  // If we're in a 3D view and not transitioning to 2D, interpolate camera
  if (is3DView) {
    let derivedCurrentCamera = currentCamera;
    let derivedNextCamera = nextCamera;

    if (derivedCurrentCamera && derivedNextCamera) {
      const interpolatedCamera = interpolateCamera(derivedCurrentCamera, derivedNextCamera, currentCamera, nextCamera, u, lerp);

      const targetCamera = Camera.fromJSON(interpolatedCamera);
      // For slider-driven interpolation keep animations off for responsiveness
      view.goTo(targetCamera, { animate: false }).catch((error) => {
        // Ignore AbortError - it's expected when rapid scroll events trigger new goTo calls
        if (error.name !== "AbortError") {
          console.error("Error setting interpolated camera:", error);
        }
      });
      return;
    }
  }

  // Otherwise handle viewpoint (2D or 3D Viewpoint)
  const targetViewpoint = interpolate2DViewpoint(currentViewpoint, nextViewpoint, u, lerp);
  if (!targetViewpoint) return;

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
    // Ignore AbortError - it's expected when rapid scroll events trigger new goTo calls
    if (error.name !== "AbortError") {
      console.error("Error setting interpolated viewpoint:", error);
    }
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
