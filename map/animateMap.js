import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-time-slider";
import "@esri/calcite-components/components/calcite-button";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/components/calcite-slider";

// Animation configuration
import { animationConfig } from "./configAnimation.js";

// Slide and scroll animation functions
import { slideAnimation } from "./animateOnSlide.js";
// import { scrollAnimation } from "./animateOnScroll.js";

let slides = [];
let mapElement = null;
let mapView = null;
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

export function configureMap(animationConfig) {
    // Try to find an existing map/scene element; otherwise create one dynamically
    const container = document.getElementById("mapContainer");
    if (!container) throw new Error("mapContainer not found in DOM");

    // Determine which component to create. animationConfig.itemType can be
    // 'webscene'|'scene' to force a 3D scene; otherwise default to 2D map.
    const prefersScene = animationConfig && (animationConfig.itemType === 'webscene' || animationConfig.itemType === 'scene');
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
        if (animationConfig?.itemId) mapElement.setAttribute("item-id", animationConfig.itemId);
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

async function initMapAnimator() {
    // Load config and choreography in sequence and rethrow on failure
    try {
        mapElement = configureMap(animationConfig);
        mapElement.addEventListener("arcgisViewReadyChange", () => {
            mapView = mapElement.view;
            slideAnimation(slides[0], mapView, timeSlider, isEmbedded);
        });
        timeSlider = document.querySelector('arcgis-time-slider');
        slides = await loadChoreography(animationConfig.mapChoreography);

    } catch (err) {
        console.error('initMapAnimator failed:', err);
        throw err;
    }
}

initMapAnimator();