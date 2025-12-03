import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-time-slider";
import "@esri/calcite-components/components/calcite-button";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/components/calcite-slider";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

// Animation configuration
import { animationConfig } from "./configAnimation.js";

// Slide and scroll animation functions
import { slideAnimation } from "./animateOnSlide.js";
// import { scrollAnimation } from "./animateOnScroll.js";

let slides = [];
let mapElement = null;
let mapView = null;
let sceneElement = null;
let sceneView = null;
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
        console.log("Created new element:", element);
    }

    element.addEventListener("arcgisViewReadyChange", () => {
        view = element.view;
    });

    try {
        console.log("Configured map with", animationConfig);
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


// --- Viewpoint synchronization between 2D and 3D views ---
// prevent echoing updates when programmatically setting viewpoints
let isSyncing = false;
const SYNC_DEBOUNCE_MS = 100;
function syncViews(fromView, toView) {
    if (!fromView || !toView || isSyncing) return;

    try {
        isSyncing = true;
        const vp = fromView.viewpoint.clone();

        // extract latitude more concisely
        const lat = fromView.center?.latitude ?? fromView.center?.lat ?? 0;
        const scaleConversionFactor = Math.cos((lat * Math.PI) / 180);

        // adjust scale when converting between 2D and 3D
        if (fromView.type === '3d' && toView.type === '2d') {
            vp.scale /= scaleConversionFactor;
        } else if (fromView.type === '2d' && toView.type === '3d') {
            vp.scale *= scaleConversionFactor;
        }

        // use goTo() to apply viewpoint to destination view (viewpoint is read-only)
        toView.goTo(vp, { animate: false });
    } catch (e) {
        console.error('syncViews error', e);
    } finally {
        setTimeout(() => { isSyncing = false; }, SYNC_DEBOUNCE_MS);
    }
}

// --- Scene creation and crossfade helpers ---

/**
 * Evaluate lifecycle for an index: ensure or schedule destroy for the scene.
 * Looks at previous, current and next slides (adjust lookahead as needed).
 * Returns true if any nearby slide has a 'maps' array with length > 1, indicating crossfading is needed.
 */
function evaluateSceneLifecycle(index) {
    const nearbySlides = [slides[index - 2], slides[index - 1], slides[index], slides[index + 1], slides[index + 2]];

    // If any nearby slide has maps.length > 1, keep/create the scene
    return nearbySlides.some(slide => slide && slide.maps && slide.maps.length > 1);
}


/**
 * Create or retrieve the secondary scene element (for 3D viewing)
 * Reuses configureMap logic but ensures scene-specific setup
 */
function ensureScene() {
    if (sceneElement) return sceneElement;

    // Configure and create the scene element using index 1
    sceneElement = configureMap(animationConfig, 1, sceneElement, sceneView);

    // Extract the view once the scene is ready
    if (sceneElement) {
        sceneElement.addEventListener("arcgisViewReadyChange", () => {
            sceneView = sceneElement.view;
        }, { once: true });
    }

    return sceneElement;
}

/**
 * Update crossfade state for the given slide index, typically called on hash changes.
 */
function updateCrossfadeForSlide(index) {
    const isCrossfade = slides[index].maps && slides[index].maps.length > 1;
    const wasCrossfade = hashIndexLast !== null && slides[hashIndexLast].maps && slides[hashIndexLast].maps.length > 1;
    if (isCrossfade !== wasCrossfade) {
        const fromMap = isCrossfade ? slides[index].maps[0] : 0;
        const toMap = isCrossfade ? slides[index].maps[1] : 1;
        const t = isCrossfade ? 0.6 : (slides[index].maps[0] === 1 ? 1 : 0);
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
        ensureScene();
        toContainer.classList.remove("hidden");
    }
    if (fromMapIndex === 1 && t < 1) {
        ensureScene();
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

    // Sync views if both are 3D or mixed
    if (mapView && sceneView) {
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
    slideAnimation(currentSlide, mapView, timeSlider, isEmbedded);

    // Update crossfade state
    updateCrossfadeForSlide(hashIndex);

    // centralize scene creation/destroy logic
    createScene(hashIndex);
  });
}


// helper: prepare scene lifecycle for a given slide index
let activeWatcher = null;
let needSceneLast = null;
let needScene = null;
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 100;
function createScene(index) {
    // decide if prev/curr/next need a scene (uses slideNeedsScene/evaluateSceneLifecycle)
    needSceneLast = needScene;
    needScene = evaluateSceneLifecycle(index); // already ensures or schedules destroy
    if (needScene) {
        // ensure watcher is attached
        if (activeWatcher) {
            // watcher already present — nothing to do
            return true;
        }

        // make sure the scene exists (ensureScene cancels scheduled destroy)
        ensureScene();

        // once sceneView exists, create watcher to sync on viewpoint changes
        // remove previous handle if any (defensive)
        if (activeWatcher) activeWatcher.remove();
        activeWatcher = reactiveUtils.watch(
            () => mapView.viewpoint,
            (newVp, oldVp) => {
                const now = Date.now();
                if (!isSyncing && sceneView && (now - lastSyncTime > SYNC_THROTTLE_MS)) {
                    lastSyncTime = now;
                    syncViews(mapView, sceneView);
                }
            }
        );

        return true;
    }

    // scene not required: remove watcher now if present
    if (activeWatcher) {
        activeWatcher.remove();
        activeWatcher = null;
    }

    // destruction is already scheduled by evaluateSceneLifecycle()
    return false;
}


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