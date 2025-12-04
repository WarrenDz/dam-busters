// Scene utilities for lifecycle management and synchronization

import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

let sceneElement = null;
let sceneView = null;
let activeWatcher = null;
let needSceneLast = null;
let needScene = null;
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 100;

// Export variables for access from other modules
export { sceneElement, sceneView, activeWatcher, needSceneLast, needScene, lastSyncTime, SYNC_THROTTLE_MS };

/**
 * Evaluate lifecycle for an index: ensure or schedule destroy for the scene.
 * Looks at previous, current and next slides (adjust lookahead as needed).
 * Returns true if any nearby slide has a 'maps' array with length > 1, indicating crossfading is needed.
 */
export function evaluateSceneLifecycle(index, slides) {
    const nearbySlides = [slides[index - 2], slides[index - 1], slides[index], slides[index + 1], slides[index + 2]];

    // If any nearby slide has maps.length > 1, keep/create the scene
    return nearbySlides.some(slide => slide && slide.maps && slide.maps.length > 1);
}

/**
 * Create or retrieve the secondary scene element (for 3D viewing)
 * Reuses configureMap logic but ensures scene-specific setup
 */
export function ensureScene(animationConfig, configureMap) {
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
 * Synchronize viewpoints between two views
 */
export function syncViews(fromView, toView) {
    if (!fromView || !toView || isSyncing) return;
    console.log("syncing views");

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

// Note: isSyncing and SYNC_DEBOUNCE_MS need to be defined or imported
let isSyncing = false;
const SYNC_DEBOUNCE_MS = 100;

/**
 * Helper: prepare scene lifecycle for a given slide index
 */
export function createScene(index, slides, mapView, animationConfig, configureMap) {
    // decide if prev/curr/next need a scene
    needSceneLast = needScene;
    needScene = evaluateSceneLifecycle(index, slides);
    if (needScene) {
        // ensure watcher is attached
        if (activeWatcher) {
            // watcher already present — nothing to do
            return true;
        }

        // make sure the scene exists
        ensureScene(animationConfig, configureMap);

        // once sceneView exists, create watcher to sync on viewpoint changes
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

    return false;
}