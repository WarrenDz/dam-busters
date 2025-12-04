// ArcGIS API for JavaScript imports and CSS
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-time-slider";
import "@esri/calcite-components/components/calcite-button";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/components/calcite-slider"
import { watch } from "@arcgis/core/core/reactiveUtils";

// Animation configuration
import { animationConfig } from "./configAnimation.js";

// Slide and scroll animation functions
import { slideAnimation } from "./animateOnSlide.js";
import { scrollAnimation } from "./animateOnScroll.js";

// Load choreography and configure map functions
import { loadChoreography, configureMap } from "./animateMap.js";

// State variables
let slides = [];
let mapElement = null;
let mapView = null;
let isEmbedded = false;
let timeSlider = null;
let currentSlideIndex = 0;
let progressSlider = null;
let suppressProgressSliderEvents = false;

// Define UI elements
const btnLeft = document.getElementById("btn-left");
const btnRight = document.getElementById("btn-right");
const slideIndicator = document.getElementById("slide-indicator");
const viewpointText = document.getElementById("viewpoint-text");
const copyBtn = document.getElementById("copy-btn");

// Update the slide indicator display with the current slide index
function updateIndicator() {
  slideIndicator.textContent = `Slide: ${currentSlideIndex}`;
}

// Enable or disable navigation buttons based on current slide index
function updateButtons() {
  // Disable left if at first slide
  btnLeft.disabled = currentSlideIndex <= 0;
  // Disable right if at last slide
  btnRight.disabled = currentSlideIndex >= slides.length - 1;
}

function setupViewpointWatcher(view) {
  // Update viewpoint JSON whenever the view changes
  // Add your custom widget into the ArcGIS UI
  
  view.ui.add("viewpoint-widget", "top-left");
  watch(() => view.viewpoint, (vp) => {
    const json = vp && typeof vp.toJSON === 'function' ? vp.toJSON() : (vp || {});

    // Format differently depending on view type
    let formatted;
    if (view.type === "2d") {
      formatted = {
        viewpoint: {
          rotation: json.rotation,
          scale: json.scale,
          targetGeometry: json.targetGeometry
        }
      };
    } else if (view.type === "3d") {
      formatted = {
        viewpoint: {
          camera: {
            position: json.camera.position,
            heading: json.camera.heading,
            tilt: json.camera.tilt
          }
        }
      };
    }

    viewpointText.value = JSON.stringify(formatted, null, 2);
  });
}

// Copy to clipboard
copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(viewpointText.value)
    .then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => copyBtn.textContent = "Copy JSON", 1500);
    });
});

/**
 * Navigates to a specific slide in the map animation sequence.
 *
 * - Validates the requested index; if out of bounds, logs a warning and exits gracefully.
 * - Updates the global `currentSlideIndex` and triggers a slide animation
 *   using the current map view, time slider, and embedding state.
 * - Resets and synchronizes the progress slider, while suppressing its
 *   event handler to avoid feedback loops.
 * - Refreshes the navigation buttons (enabling/disabling as needed) and
 *   updates the slide indicator display.
 */
function goToSlide(index) {
  if (index < 0 || index >= slides.length) {
    console.warn("No more slides available at index:", index);
    return; // fail gracefully
  }

  currentSlideIndex = index;
  slideAnimation(slides[currentSlideIndex], mapView, timeSlider, isEmbedded);

  if (progressSlider) {
    suppressProgressSliderEvents = true;
    progressSlider.value = progressSlider.min || 0;
    progressSlider.dispatchEvent(new Event("calciteSliderInput", { bubbles: true }));
  }
  updateButtons();
  updateIndicator();
}

/**
 * Handles the "previous slide" button click.
 *
 * - Invokes `goToSlide` with the index one less/more than the current slide.
 * - Allows the user to navigate through the slide sequence.
 * - Disabled automatically when already at the first slide (via `updateButtons`).
 */
btnLeft.addEventListener("click", () => {
  goToSlide(currentSlideIndex - 1);
});

btnRight.addEventListener("click", () => {
  goToSlide(currentSlideIndex + 1);
});

/**
 * Initializes the progress slider used for scroll-based slide animation.
 *
 * - Locates the slider element (`#scrollProgress`) and assigns a custom
 *   `labelFormatter` to display contextual labels ("Current Slide" / "Next Slide")
 *   on tick marks at the min and max values.
 * - Attaches a listener for the `calciteSliderInput` event:
 *    • If the event was triggered programmatically (flagged by
 *      `suppressProgressSliderEvents`), the flag is cleared and the event ignored
 *      to prevent feedback loops.
 *    • Otherwise, calculates a normalized progress value (0–1) from the slider input.
 *    • Retrieves the next slide in sequence and calls `scrollAnimation` to animate
 *      the transition between the current and next slide based on scroll progress.
 *
 * This function wires up the slider so that user scroll input drives smooth
 * animations between slides in the map view.
 */
function setupSliderListener() {
  progressSlider = document.getElementById("scrollProgress");
  progressSlider.labelFormatter = function (value, type) {
    if (type === "tick") {
      return value === progressSlider.min ?
        "Current Slide" :
        value === progressSlider.max ?
          "Next Slide" :
          undefined;
    }
  };
  if (progressSlider) {
    progressSlider.addEventListener("calciteSliderInput", (event) => {
      if (suppressProgressSliderEvents) {
        // clear the flag and ignore this programmatic event
        suppressProgressSliderEvents = false;
        return;
      }
      const value = event.target.value / 100;
      // Add logic to handle slider value changes
      const nextSlide = slides[currentSlideIndex + 1];
      // Scroll-based animation
      scrollAnimation(slides[currentSlideIndex], nextSlide, value, mapView, timeSlider);
    });

  }
}

/**
 * Initializes the map animation environment.
 *
 * - Configures the ArcGIS map using a predefined animation configuration.
 * - Attaches a listener for the `arcgisViewReadyChange` event:
 *    • When the map view becomes ready, stores the view reference.
 *    • Immediately triggers the first slide animation to display initial content.
 * - Locates the ArcGIS time slider component in the DOM for temporal control.
 * - Loads the slide choreography sequence asynchronously from a JSON file.
 * - Sets up the progress slider listener to enable scroll-based animations.
 * - Updates navigation buttons to reflect the initial slide state.
 */
async function initMapAnimator() {
  // Load config and choreography in sequence and rethrow on failure
  try {
    mapElement = configureMap(animationConfig, 0, mapElement, mapView);
    mapElement.addEventListener("arcgisViewReadyChange", () => {
      mapView = mapElement.view;
      slideAnimation(slides[0], mapView, timeSlider, isEmbedded);
      setupViewpointWatcher(mapView);
    });
    timeSlider = document.querySelector('arcgis-time-slider');
    slides = await loadChoreography(animationConfig.mapChoreography);
    setupSliderListener();
    updateButtons();

  } catch (err) {
    console.error('initMapAnimator failed:', err);
    throw err;
  }
}

initMapAnimator();