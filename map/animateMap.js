import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-time-slider";
import "@esri/calcite-components/components/calcite-button";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/core/assets/esri/themes/dark/main.css";
import "@esri/calcite-components/components/calcite-slider";

// Logger utility
import { log } from '../src/logger.js';

// Animation configuration
import { animationConfig } from "./configAnimation.js";

// Scene utilities
import { sceneElement, sceneView, evaluateSceneLifecycle, ensureScene, syncViews, createScene } from "./sceneUtils.js";

// Slide and scroll animation functions
import { slideAnimation } from "./animateOnSlide.js";
import { scrollAnimation } from "./animateOnScroll.js";

let slides = [];
let mapElement = null;
let mapView = null;
let timeSlider = null;
let isEmbedded = false;
let hashIndexLast = null;
let hashIndex = null;

export async function loadChoreography(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to fetch choreography: ${response.status}`);
        slides = await response.json();
        log("Loaded slides", slides);
        return slides;
    } catch (error) {
        console.error("Failed to load choreography:", error);
        throw error;
    }
}

export function configureMap(animationConfig, mapIndex, element, view) {
    // Try to find an existing map/scene element; otherwise create one dynamically
    const container = document.getElementById(animationConfig.maps[mapIndex].container);
    if (!container) throw new Error(animationConfig.maps[mapIndex].container, "container not found in DOM");

    // Determine which component to create. animationConfig.itemType can be
    // 'webscene'|'scene' to force a 3D scene; otherwise default to 2D map.
    const prefersScene = animationConfig && animationConfig.maps[mapIndex].type === 'webscene';
    const tagName = prefersScene ? 'arcgis-scene' : 'arcgis-map';

    // If a map/scene already exists inside the container, use it; otherwise create one
    element = container.querySelector('arcgis-map, arcgis-scene');
    if (!element) {
        element = document.createElement(tagName);
        element.id = 'map';
        // Insert the map/scene as first child so controls overlay correctly
        container.insertBefore(element, container.firstChild);

        // For scenes, create and append a dedicated time slider inside an arcgis-expand if not present
        if (prefersScene) {
            let sceneExpand = element.querySelector('arcgis-expand');
            if (!sceneExpand) {
                sceneExpand = document.createElement('arcgis-expand');
                sceneExpand.setAttribute('position', 'bottom-right');
                sceneExpand.setAttribute('mode', 'floating');
                element.appendChild(sceneExpand);
            }
            let sceneTimeSlider = sceneExpand.querySelector('arcgis-time-slider');
            if (!sceneTimeSlider) {
                sceneTimeSlider = document.createElement('arcgis-time-slider');
                sceneTimeSlider.setAttribute('slot', 'bottom-right');
                sceneTimeSlider.setAttribute('reference-element', 'scene');
                sceneTimeSlider.setAttribute('mode', 'cumulative-from-start');
                sceneTimeSlider.setAttribute('play-rate', animationConfig?.timePlayRate || 250);
                sceneExpand.appendChild(sceneTimeSlider);
            }
        }
    }

    element.addEventListener("arcgisViewReadyChange", () => {
        view = element.view;
    });

    try {
        // Apply configuration attributes from animationConfig
        if (animationConfig?.maps[mapIndex]?.itemId && element.getAttribute("item-id") !== animationConfig.maps[mapIndex].itemId) {
            element.setAttribute("item-id", animationConfig.maps[mapIndex].itemId);
        }
        if (animationConfig?.zoom && element.getAttribute("zoom") !== animationConfig.zoom) {
            element.setAttribute("zoom", animationConfig.zoom);
        }
        if (animationConfig?.center && element.getAttribute("center") !== animationConfig.center) {
            element.setAttribute("center", animationConfig.center);
        }
        timeSlider = document.querySelector('arcgis-time-slider');
        if (timeSlider && animationConfig?.timePlayRate !== undefined) timeSlider.setAttribute("play-rate", animationConfig.timePlayRate);
        if (animationConfig?.disableMapNav) {
            // if mapView is not yet ready, these handlers will be attached later when view is available
            const attachNavHandlers = () => {
                if (!view) return;
                view.navigation.mouseWheelZoomEnabled = false;
                view.navigation.dragEnabled = false;
                view.navigation.doubleClickZoomEnabled = false;
            };
            // attempt immediate attach, otherwise attach once view is ready
            if (view) attachNavHandlers();
            else element.addEventListener("arcgisViewReadyChange", attachNavHandlers, { once: true });
        }
        return element;

    } catch (error) {
        console.error("Failed to configure map:", error);
    }
}


// Update crossfade state for the given slide index, typically called on hash changes.
function updateCrossfadeForSlide(index) {
    const isCrossfade = slides[index].maps && slides[index].maps.length > 1;
    const wasCrossfade = hashIndexLast !== null && slides[hashIndexLast].maps && slides[hashIndexLast].maps.length > 1;
    if (isCrossfade !== wasCrossfade) {
        const fromMap = isCrossfade ? slides[index].maps[0] : 0;
        const toMap = isCrossfade ? slides[index].maps[1] : 1;
        const t = isCrossfade ? 1 : (slides[index].maps[0] === 1 ? 1 : 0);
        crossfade(fromMap, toMap, t);
    }
}

/**
 * Scroll-driven crossfade between two maps
 * fromMapIndex - Index of the map to fade from (0 or 1)
 * toMapIndex - Index of the map to fade to (0 or 1)
 * t - Progress value between 0 (fully fromMap) and 1 (fully toMap)
 * Called frequently from scroll listener with interpolated progress
 */
export function crossfade(fromMapIndex, toMapIndex, t) {
    const fromContainer = document.getElementById(animationConfig.maps[fromMapIndex].container);
    const toContainer = document.getElementById(animationConfig.maps[toMapIndex].container);
    t = Math.max(0, Math.min(1, t));

    // Ensure the 'to' map exists if needed
    if (toMapIndex === 1 && t > 0) {
        ensureScene(animationConfig, configureMap);
        toContainer.classList.remove("hidden");
    }
    if (fromMapIndex === 1 && t < 1) {
        ensureScene(animationConfig, configureMap);
        fromContainer.classList.remove("hidden");
    }

    // If fully to one map, hide the other (lenient thresholds)
    if (t < 0.2) {
        toContainer.classList.add("hidden");
    } else if (t > 0.8) {
        fromContainer.classList.add("hidden");
    }

    // Set opacities for smooth crossfade
    fromContainer.style.opacity = String(1 - t);
    toContainer.style.opacity = String(t);

    // Pointer events to the more opaque view
    fromContainer.style.pointerEvents = (t < 0.5) ? 'auto' : 'none';
    toContainer.style.pointerEvents = (t > 0.5) ? 'auto' : 'none';

    // Sync views only during crossfade transitions (not when fully on one map)
    const fromView = fromMapIndex === 0 ? mapView : sceneView;
    const toView = toMapIndex === 0 ? mapView : sceneView;
    if (fromView && toView && t > 0 && t < 1) {
        syncViews(fromView, toView);
    }
}


/**
 * Listen for changes in the URL hash and triggers slide animation
 * based on the corresponding index in slides.
 */
function setupHashListener() {
  window.addEventListener('hashchange', () => {
    hashIndexLast = hashIndex
    hashIndex = parseInt(window.location.hash.substring(1), 10);
    if (isNaN(hashIndex) || !slides[hashIndex]) return;

    const currentSlide = slides[hashIndex];

    // Determine the active view and timeslider based on the slide's maps array
    let activeView = mapView;
    let activeTimeSlider = timeSlider;
    if (currentSlide.maps && currentSlide.maps[0] === 1) {
        // If the primary map is the scene (index 1), use sceneView and scene time slider
        if (!sceneView) {
            ensureScene(animationConfig, configureMap);
        }
        activeView = sceneView;
        activeTimeSlider = sceneElement ? sceneElement.querySelector('arcgis-time-slider') : timeSlider;
    }
    slideAnimation(currentSlide, activeView, activeTimeSlider, isEmbedded);

    // For crossfade slides, also apply viewpoint to the "to" view
    if (currentSlide.maps && currentSlide.maps.length > 1) {
      const toMap = currentSlide.maps[1];
      const toView = toMap === 0 ? mapView : sceneView;
      if (toView) {
        slideAnimation(currentSlide, toView, activeTimeSlider, isEmbedded);
      }
    }

    // Update crossfade state
    updateCrossfadeForSlide(hashIndex);

    // centralize scene creation/destroy logic
    createScene(hashIndex, slides, mapView, animationConfig, configureMap);
  });
}

/**
 * Listen for postMessage events from the "storymap-controller" to coordinate map animations.
 * Determines whether the map is embedded and sets up hash animation if not.
 * Triggers scroll-based animations based on slide progress and static slide updates
 * when the slide index changes.
 */
function setupMessageListener() {
  window.addEventListener("message", (event) => {
    if (event.data.source !== "storymap-controller") return;

    const payload = event.data.payload;

    if (payload.isEmbedded) {
      // log("This story is being viewed via script embed - deferring to scroll animation.");
      isEmbedded = true;
    } else {
      // log("Map is not embedded — enabling hash-based navigation.");
      isEmbedded = false;
    }

    const currentSlide = slides[payload.slide];
    const nextSlide = slides[payload.slide + 1];

    // Determine the active view and timeslider based on the slide's maps array
    let activeView = mapView;
    let activeTimeSlider = timeSlider;
    if (currentSlide.maps && currentSlide.maps[0] === 1) {
        // If the primary map is the scene (index 1), use sceneView and scene time slider
        if (!sceneView) {
            ensureScene(animationConfig, configureMap);
        }
        activeView = sceneView;
        activeTimeSlider = sceneElement ? sceneElement.querySelector('arcgis-time-slider') : timeSlider;
    }

    // Scroll-based animation
    scrollAnimation(currentSlide, nextSlide, payload.progress, activeView, activeTimeSlider);
    // Scroll-based crossfade
    if (currentSlide.maps && currentSlide.maps.length > 1) {
      const fromMap = currentSlide.maps[0];
      const toMap = currentSlide.maps[1];
      crossfade(fromMap, toMap, payload.progress);
    }

    // Slide change detection
    if (payload.slide !== hashIndexLast) {
      hashIndexLast = payload.slide;
      slideAnimation(currentSlide, activeView, activeTimeSlider, isEmbedded); // using isEmbedded to mute some property changes when viewed in embed
    }
  });
}


// Initialize the map animator
// This function is called to set up the map and start the animation
async function initMapAnimator() {
    // Load config and choreography in sequence and rethrow on failure
    try {
        mapElement = configureMap(animationConfig, 0, mapElement, mapView);
        mapElement.addEventListener("arcgisViewReadyChange", () => {
            mapView = mapElement.view;
            slideAnimation(slides[0], mapView, timeSlider, isEmbedded);
        });
        timeSlider = document.querySelector('arcgis-time-slider');
        slides = await loadChoreography(animationConfig.mapChoreography);
        setupHashListener()
        setupMessageListener();

    } catch (err) {
        console.error('initMapAnimator failed:', err);
        throw err;
    }
}

initMapAnimator();