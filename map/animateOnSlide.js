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
import Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";

import { animationConfig } from "./configAnimation.js";

// Logger utility
import { log } from '../src/logger.js';

/**
 * Maps slide data keys to their corresponding animation handler functions,
 * enabling dynamic choreography of viewpoint and time slider transitions.
 */
const choreographyHandlers = {
  viewpoint: toggleViewpoint,
  timeSlider: toggleTimeSlider,
  layerVisibility: toggleLayerVisibility,
  trackRenderer: toggleTrackRenderer,
  environment: toggleEnvironment
};

/**
 * Executes animation handlers for each key in slideData using shared context.
 * Skips keys listed in NON_EMBED_EXCLUDE_KEYS when in embedded mode.
 * Logs each triggered animation and catches any handler errors.
 */
const NON_EMBED_EXCLUDE_KEYS = new Set(["viewpoint"]);

export function slideAnimation(slideData, view, timeSlider, embedded) {
  const context = { slideData, view, timeSlider, embedded };

  Object.entries(slideData).forEach(([key, value]) => {
    const handler = choreographyHandlers[key];
    if (!handler) return;

    // Skip excluded keys when not embedded
    if (embedded && NON_EMBED_EXCLUDE_KEYS.has(key)) return;

    try {
      handler(context);
    } catch (error) {
      console.error(`Error processing '${key}':`, error);
    }
  });
}

/**
 * Sets the map view to the viewpoint defined in slideData,
 * animating the transition over 1 second. Logs errors if the transition fails.
 */
function toggleViewpoint({ slideData, view, timeSlider, embedded }) {
  log("Triggering slide viewpoint animation");
  // Prefer camera when running in a 3D SceneView and camera data is available.
  const viewpointData = slideData.viewpoint;
  const cameraData = slideData.camera || viewpointData?.camera;

  if (cameraData) {
    try {
      const targetCamera = Camera.fromJSON(cameraData);
      view.goTo(targetCamera, animationConfig.goToConfig).catch((error) => {
          console.error("Error setting camera from viewpoint data:", error);
        });
      return;
    } catch (error) {
      console.error("Failed to construct Camera from slide data:", error);
      // fall through to viewpoint handling
    }
  }

  // Otherwise fall back to viewpoint navigation (works for 2D view and SceneView viewpoints)
  if (viewpointData) {

    try {
      const targetViewpoint = Viewpoint.fromJSON(viewpointData);
      const targetGeometry = targetViewpoint.targetGeometry;
      let target;
      if (animationConfig.mapFit === "scale") {
        const centerX = (targetGeometry.xmin + targetGeometry.xmax) / 2;
        const centerY = (targetGeometry.ymin + targetGeometry.ymax) / 2;
        target = {
          center: new Point({
            x: centerX,
            y: centerY,
            spatialReference: targetGeometry.spatialReference
          }),
          scale: targetViewpoint.scale
        };
      } else if (animationConfig.mapFit === "extent") {
        target = new Extent({
          xmin: targetGeometry.xmin,
          ymin: targetGeometry.ymin,
          xmax: targetGeometry.xmax,
          ymax: targetGeometry.ymax,
          spatialReference: targetGeometry.spatialReference
        });
      } else {
        target = targetViewpoint;
      }
      view.goTo(target, animationConfig.goToConfig).catch((error) => {
          console.error("Error setting viewpoint:", error);
        });
      return;
    } catch (error) {
      console.error("Failed to construct Viewpoint from slide data:", error);
    }
  }
}

/**
 * Update the timeSlider using configuration from choreographyData.
 * Sets the full time extent, interval stops, and starting frame.
 * Automatically starts playback if the slider is ready and not in embedded mode.
 */
function toggleTimeSlider({ slideData, view, timeSlider, embedded }) {
  if (
    timeSlider &&
    slideData.timeSlider &&
    slideData.timeSlider.timeSliderStart &&
    slideData.timeSlider.timeSliderEnd
  ) {
    const timeStart = slideData.timeSlider.timeSliderStart;
    const timeEnd = slideData.timeSlider.timeSliderEnd;
    const timeUnit = slideData.timeSlider.timeSliderUnit;
    const timeStep = slideData.timeSlider.timeSliderStep;
    const startFrame = new Date(timeStart);
    const endFrame = new Date(timeEnd);

    // Configure time extent
    timeSlider.fullTimeExtent = { start: startFrame, end: endFrame };
    timeSlider.timeExtent = { start: null, end: startFrame };

    // Set the time slider interval based on choreography
    timeSlider.stops = {
      interval: {
        value: timeStep,
        unit: timeUnit,
      },
    };

    // Start the time slider if not already playing and if outside script embed story
    if (timeSlider.state === "ready" && !embedded) {
      timeSlider.play();
    } else if (timeSlider.state === "ready" && embedded) {
      timeSlider.stop();
    } else if (!timeSlider) {
      log("No timeSlider component found.");
    } else {
      log("No timeSlider configuration found in choreography.");
    }
  }
}

/**
 * Update the environment using configuration defined in choreographyData.
 * Sets the weather, lighting, atmosphere, and stars.
 */
function toggleEnvironment({slideData, view, timeSlider, embedded }) {
  const slideEnv = slideData.environment;
  if (!slideEnv) return;

  // Only set environment on views that support it (SceneView)
  if (!view || typeof view.environment === 'undefined') return;

  // Read current environment to allow partial updates
  const currentEnv = view.environment || {};

  const env = {};

  // Lighting
  if (slideEnv.lighting) {
    const lighting = {};
    if (slideEnv.lighting.type !== undefined) lighting.type = slideEnv.lighting.type;
    if (slideEnv.lighting.datetime !== undefined) {
      const d = new Date(slideEnv.lighting.datetime);
      if (!Number.isNaN(d.getTime())) lighting.datetime = d;
    }
    if (slideEnv.lighting.displayUTCOffset !== undefined) lighting.displayUTCOffset = slideEnv.lighting.displayUTCOffset;
    if (Object.keys(lighting).length) env.lighting = lighting;
  }

  // Atmosphere and stars
  if (slideEnv.atmosphereEnabled !== undefined) env.atmosphereEnabled = !!slideEnv.atmosphereEnabled;
  if (slideEnv.starsEnabled !== undefined) env.starsEnabled = !!slideEnv.starsEnabled;

  // Weather
  if (slideEnv.weather) {
    const weather = {};
    if (slideEnv.weather.type !== undefined) weather.type = slideEnv.weather.type;
    if (slideEnv.weather.cloudCover !== undefined) {
      const cc = Number(slideEnv.weather.cloudCover);
      if (!Number.isNaN(cc)) weather.cloudCover = cc;
    }
    if (slideEnv.weather.precipitation !== undefined) {
      const p = Number(slideEnv.weather.precipitation);
      if (!Number.isNaN(p)) weather.precipitation = p;
    }
    if (Object.keys(weather).length) env.weather = weather;
  }

  // Merge with current environment so unspecified properties are preserved
  const newEnv = Object.assign({}, currentEnv, env);

  try {
    view.environment = newEnv;
  } catch (err) {
    console.error('Failed to apply environment to view:', err);
  }
}

/**
 * Updates map layer visibility based on slideData configuration.
 * Turns on layers listed in layersOn and turns off layers listed in layersOff
 * by matching layer titles in the view.
 */
function toggleLayerVisibility({ slideData, view, timeSlider, embedded }) {
  const mapLayers = view.map.layers;
  function setLayerVisibility(layerNames, visibility) {
    if (layerNames && layerNames.length > 0) {
      mapLayers.forEach((mapLayer) => {
        if (layerNames.includes(mapLayer.title)) {
          mapLayer.visible = visibility; // Set visibility based on the argument
          log(`Layer '${mapLayer.title}' visibility set to ${visibility}`);
        }
      });
    }
  }
  const layersOn = slideData.layerVisibility.layersOn;
  const layersOff = slideData.layerVisibility.layersOff;

  setLayerVisibility(layersOn, true); // Turn on specified layers
  setLayerVisibility(layersOff, false); // Turn off specified layers
}

/**
 * Reconfigures and reapplies a track renderer to its corresponding map layer
 * using parameters from slideData and timeSlider. Performs a hard reset by
 * removing and re-adding the layer, then updates its timeInfo and trackInfo.
 * Ensures the layer is visible.
 */
function toggleTrackRenderer({ slideData, view, timeSlider, embedded }) {
  const mapLayers = view.map.layers;
  const trackTimeConfig = slideData.timeSlider;
  async function applyTrackRenderer(trackRenderer, timeSlider) {
    try {
      const trackLayerField = trackRenderer.trackFieldName;
      const trackTimeSliderUnit = timeSlider.timeSliderUnit;
      const trackTimeSliderStep = timeSlider.timeSliderStep;
      let trackLayer = mapLayers.find(
        (layer) => layer.title === trackRenderer.trackLayerName
      );

      if (trackLayer) {
        const layerIndex = view.map.layers.indexOf(trackLayer);

        try {
          view.map.remove(trackLayer);
        } catch (error) {
          console.error("Failed to remove track layer:", error);
        }

        trackLayer = trackLayer.clone();

        try {
          view.map.add(trackLayer, layerIndex);
        } catch (error) {
          console.error("Failed to add track layer:", error);
        }
        await trackLayer.when(); // Wait for the layer to load
        const trackStartField = trackLayer.timeInfo.startField;
        trackLayer.visible = true; // Make the layer visible
        trackLayer.timeInfo = {
          startField: trackStartField,
          trackIdField: trackLayerField,
          interval: {
            unit: trackTimeSliderUnit,
            value: trackTimeSliderStep,
          },
        };
        // Apply renderer from choreography data
        trackLayer.trackInfo = trackRenderer.trackInfo;
        log("Track renderer applied.", trackLayer.trackInfo);
      }
    } catch (error) {
      console.error("Failed to set track Renderer:", error);
    }
  }
  applyTrackRenderer(slideData.trackRenderer, trackTimeConfig);
}