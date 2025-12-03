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

export function configureMap(animationConfig, mapIndex) {
    // Try to find an existing map/scene element; otherwise create one dynamically
    const container = document.getElementById(animationConfig.maps[mapIndex].container);
    if (!container) throw new Error(animationConfig.maps[mapIndex].container, "container not found in DOM");

    // Determine which component to create. animationConfig.itemType can be
    // 'webscene'|'scene' to force a 3D scene; otherwise default to 2D map.
    const prefersScene = animationConfig && animationConfig.maps[mapIndex].type === 'webscene';
    const tagName = prefersScene ? 'arcgis-scene' : 'arcgis-map';

    // If a map/scene already exists inside the container, use it; otherwise create one
    mapElement = container.querySelector('arcgis-map, arcgis-scene');
    if (!mapElement) {
        mapElement = document.createElement(tagName);
        mapElement.id = 'map';
        // Insert the map/scene as first child so controls overlay correctly
        container.insertBefore(mapElement, container.firstChild);

        // Move any existing controls (animationControls, time expand/slider) into the map element
        const children = Array.from(container.querySelectorAll(':scope > *'));
        for (const child of children) {
            if (child !== mapElement) {
                mapElement.appendChild(child);
            }
        }
        console.log("Created new element:", mapElement);
    }

    mapElement.addEventListener("arcgisViewReadyChange", () => {
        mapView = mapElement.view;
    });

    try {
        console.log("Configured map with", animationConfig);
        if (animationConfig?.maps[mapIndex]?.itemId) mapElement.setAttribute("item-id", animationConfig.maps[mapIndex].itemId);
        if (animationConfig?.zoom) mapElement.setAttribute("zoom", animationConfig.zoom);
        if (animationConfig?.center) mapElement.setAttribute("center", animationConfig.center);
        timeSlider = document.querySelector('arcgis-time-slider');
        if (timeSlider && animationConfig?.timePlayRate !== undefined) timeSlider.setAttribute("play-rate", animationConfig.timePlayRate);
        if (animationConfig?.disableMapNav) {
            // if mapView is not yet ready, these handlers will be attached later when view is available
            const attachNavHandlers = () => {
                if (!mapView) return;
                mapView.on("mouse-wheel", (event) => {
                    event.stopPropagation();
                });
                mapView.on("drag", (event) => {
                    event.stopPropagation();
                });
            };
            // attempt immediate attach, otherwise attach once view is ready
            if (mapView) attachNavHandlers();
            else mapElement.addEventListener("arcgisViewReadyChange", attachNavHandlers, { once: true });
        }
        return mapElement;

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
 * Create or retrieve the secondary scene element (for 3D viewing)
 * Reuses configureMap logic but ensures scene-specific setup
 */
function ensureScene() {
    if (sceneElement) return sceneElement;

    // Configure and create the scene element using index 1
    sceneElement = configureMap(animationConfig, 1);

    // Extract the view once the scene is ready
    if (sceneElement) {
        sceneElement.addEventListener("arcgisViewReadyChange", () => {
            sceneView = sceneElement.view;
        }, { once: true });
    }

    return sceneElement;
}

/**
 * Remove the secondary scene element and clean up references
 */
function destroyScene() {
    if (!sceneElement) return;

    try {
        // Remove event listeners and clean up the view
        if (sceneView) {
            sceneView.destroy?.();
        }

        // Remove the element from the DOM
        sceneElement.remove?.();
    } catch (e) {
        console.warn('Error destroying scene:', e);
    } finally {
        sceneElement = null;
        sceneView = null;
    }
}

/**
 * Scroll-driven crossfade between map and scene
 * @param {number} t - Value between 0 (2D map) and 1 (3D scene)
 * Called frequently from scroll listener with interpolated progress
 */
export function setCrossfade(t) {
    t = Math.max(0, Math.min(1, t));

    // Fully 2D: destroy scene to save resources
    if (t === 0) {
        if (sceneElement) {
            sceneElement.style.opacity = '0';
            sceneElement.style.pointerEvents = 'none';
            destroyScene();
        }
        mapElement.style.opacity = '1';
        mapElement.style.pointerEvents = 'auto';
        return;
    }

    // Fully 3D: ensure scene exists and hide map
    if (t === 1) {
        ensureScene();
        mapElement.style.opacity = '0';
        mapElement.style.pointerEvents = 'none';
        sceneElement.style.opacity = '1';
        sceneElement.style.pointerEvents = 'auto';
        return;
    }

    // Intermediate crossfade: both visible with scroll-driven opacity
    ensureScene();
    mapElement.style.opacity = String(1 - t);
    sceneElement.style.opacity = String(t);

    // Pointer events to the more opaque view
    mapElement.style.pointerEvents = (t < 0.5) ? 'auto' : 'none';
    sceneElement.style.pointerEvents = (t > 0.5) ? 'auto' : 'none';

    // Sync views so cameras stay aligned during scroll
    if (mapView && sceneView) {
        syncViews(mapView, sceneView);
    }
}

/**
 * Listen for changes in the URL hash and triggers slide animation
 * based on the corresponding index in slides.
 */
let activeWatcher = null;

function setupHashListener() {
    window.addEventListener("hashchange", function () {
        const hashIndex = parseInt(window.location.hash.substring(1), 10);
        if (isNaN(hashIndex) || !slides[hashIndex]) return;

        const currentSlide = slides[hashIndex];
        const nextSlide = slides[hashIndex + 1];

        slideAnimation(currentSlide, mapView, timeSlider, isEmbedded);

        // Check if the next slide requires a different map (and thus a scene)
        if (nextSlide && currentSlide.map !== nextSlide.map) {
            // Only create scene if it doesn't already exist
            if (!sceneElement) {
                sceneElement = configureMap(animationConfig, 1);

                // Once scene is ready, extract its view
                sceneElement.addEventListener("arcgisViewReadyChange", () => {
                    sceneView = sceneElement.view;
                }, { once: true });
            }

            // Remove old watcher and set up a new one
            if (activeWatcher) activeWatcher.remove();

            // Watch for the map becoming stationary, then sync once
            activeWatcher = reactiveUtils.watch(
                () => mapView.stationary,
                (stationary) => {
                    if (stationary && sceneView) {
                        syncViews(mapView, sceneView);
                    }
                }
            );
        }
    });
}


async function initMapAnimator() {
    // Load config and choreography in sequence and rethrow on failure
    try {
        mapElement = configureMap(animationConfig, 0);
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