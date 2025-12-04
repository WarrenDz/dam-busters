import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-time-slider";
import "@esri/calcite-components/components/calcite-button";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/components/calcite-slider";

// Animation configuration
import { animationConfig } from "./configAnimation.js";

// Scene utilities
import { sceneElement, sceneView, evaluateSceneLifecycle, ensureScene, syncViews, createScene } from "./sceneUtils.js";

// Slide and scroll animation functions
import { slideAnimation } from "./animateOnSlide.js";
// import { scrollAnimation } from "./animateOnScroll.js";

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
        console.log("Loaded slides", slides);
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

        // Move any existing controls (animationControls, time expand/slider) into the map element
        const children = Array.from(container.querySelectorAll(':scope > *'));
        for (const child of children) {
            if (child !== element) {
                element.appendChild(child);
            }
        }
    }

    element.addEventListener("arcgisViewReadyChange", () => {
        view = element.view;
    });

    try {
        // Apply configuration attributes from animationConfig
        if (animationConfig?.maps[mapIndex]?.itemId) element.setAttribute("item-id", animationConfig.maps[mapIndex].itemId);
        if (animationConfig?.zoom) element.setAttribute("zoom", animationConfig.zoom);
        if (animationConfig?.center) element.setAttribute("center", animationConfig.center);
        timeSlider = document.querySelector('arcgis-time-slider');
        if (timeSlider && animationConfig?.timePlayRate !== undefined) timeSlider.setAttribute("play-rate", animationConfig.timePlayRate);
        if (animationConfig?.disableMapNav) {
            // if mapView is not yet ready, these handlers will be attached later when view is available
            const attachNavHandlers = () => {
                if (!view) return;
                view.on("mouse-wheel", (event) => {
                    event.stopPropagation();
                });
                view.on("drag", (event) => {
                    event.stopPropagation();
                });
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
 * @param {number} fromMapIndex - Index of the map to fade from (0 or 1)
 * @param {number} toMapIndex - Index of the map to fade to (0 or 1)
 * @param {number} t - Progress value between 0 (fully fromMap) and 1 (fully toMap)
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

    // If fully to one map, hide the other
    if (t === 0) {
        toContainer.classList.add("hidden");
    } else if (t === 1) {
        fromContainer.classList.add("hidden");
    }

    // Set opacities for smooth crossfade
    fromContainer.style.opacity = String(1 - t);
    toContainer.style.opacity = String(t);

    // Pointer events to the more opaque view
    fromContainer.style.pointerEvents = (t < 0.5) ? 'auto' : 'none';
    toContainer.style.pointerEvents = (t > 0.5) ? 'auto' : 'none';

    // Sync views only during crossfade transitions (not when fully on one map)
    if (mapView && sceneView && t > 0 && t < 1) {
        syncViews(mapView, sceneView);
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

    // Determine the active view based on the slide's maps array
    let activeView = mapView;
    if (currentSlide.maps && currentSlide.maps[0] === 1) {
        // If the primary map is the scene (index 1), use sceneView
        if (!sceneView) {
            ensureScene(animationConfig, configureMap);
        }
        activeView = sceneView;
    }
    slideAnimation(currentSlide, activeView, timeSlider, isEmbedded);

    // Update crossfade state
    updateCrossfadeForSlide(hashIndex);

    // centralize scene creation/destroy logic
    createScene(hashIndex, slides, mapView, animationConfig, configureMap);
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

    } catch (err) {
        console.error('initMapAnimator failed:', err);
        throw err;
    }
}

initMapAnimator();