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

import { nodeConfig } from './configNode.js';
import { log } from './logger.js';
import throttle from 'lodash.throttle';
// This sets shared state variables used across the scroll-driven story map
let isDocked = false;
let dockStartScroll = null;

let lastScrollY = window.scrollY;
let scrollDirection = "down"; // or 'up';
let currentSlide = 0;

log("Scroll listener initialized.");

// --- Utility Functions ---
// DOM readiness, panel height, scroll bounds...

// Waits for an element matching the selector to appear in the DOM,
// then executes the callback with the found element. Uses MutationObserver for efficiency.
function waitForElement(selector, callback) {
  const element = document.querySelector(selector);
  if (element) {
    callback(element);
    return;
  }

  const observer = new MutationObserver(() => {
    const element = document.querySelector(selector);
    if (element) {
      observer.disconnect();
      callback(element);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Calculates the effective height of a narrative panel element,
// adjusting for top margin if it's the first panel,
// bottom padding if it's the last panel,
// or both top and bottom margins for other panels.
function getPanelHeight(panel) {
  return panel.classList.contains("first")
    ? panel.offsetHeight - parseFloat(getComputedStyle(panel).marginTop)
    : panel.classList.contains("last")
    ? panel.offsetHeight - parseFloat(getComputedStyle(panel).paddingBottom)
    : panel.offsetHeight +
      parseFloat(getComputedStyle(panel).marginBottom) +
      parseFloat(getComputedStyle(panel).marginTop);
}

// Computes the scroll boundaries for the current slide panel.
// Accumulates the height of all previous panels to determine the start scroll position,
// then adds the current panel's height to get the end scroll position.
function getPanelScrollBounds(panels, currentSlide) {
  let panelStartScroll = dockStartScroll;

  for (let i = 0; i < currentSlide; i++) {
    panelStartScroll += getPanelHeight(panels[i]);
  }

  const panelHeight = getPanelHeight(panels[currentSlide]);
  const panelEndScroll = panelStartScroll + panelHeight;

  return { panelStartScroll, panelEndScroll };
}

// Calculates the scroll progress of the current panel as a normalized value between 0 and 1.
// Uses the panel's scroll bounds to determine how far the user has scrolled within it.
function getPanelProgress(panels, currentSlide, scrollY) {
  const { panelStartScroll, panelEndScroll } = getPanelScrollBounds(
    panels,
    currentSlide
  );
  let progress =
    (scrollY - panelStartScroll) / (panelEndScroll - panelStartScroll);
  return Math.max(0, Math.min(1, progress));
}

// --- Observers ---

// Sets up a MutationObserver to track changes to the iframe's 'src' attribute.
// When the 'src' updates, it parses the URL fragment (after '#') to extract the slide number,
// and updates the global `currentSlide` accordingly.
const createIframeSrcObserver = (iframe) => {
  return new MutationObserver((mutations) => {
    const newSrc = iframe.getAttribute("src") || "";
    const parts = newSrc.split("#");
    const slideNumber = parseInt(parts.length > 1 ? parts.pop() : "0", 10);
    currentSlide = isNaN(slideNumber) ? 0 : slideNumber;
    log("Updated current slide:", currentSlide);
  });
};

// Initializes a MutationObserver to monitor docking state changes on a target element.
// When the element becomes docked (via 'docked' class), it records the scroll position
// to begin tracking scroll progress. Undocks reset the tracking state.
function setupDockingObserver(nodeSelector) {
  const targetSelectorDocked = `${nodeSelector} > div > div[class*='jsx-'][class*='container'][class*='main']`;

  waitForElement(targetSelectorDocked, (target) => {
    const observer = new MutationObserver(() => {
      const currentlyDocked = target.classList.contains("docked");

      if (currentlyDocked && !isDocked) {
        isDocked = true;
        const currentScroll = window.scrollY;
        log(currentScroll, scrollDirection);

        if (scrollDirection === "down") {
          dockStartScroll = currentScroll;
        }

        log("Docked: Starting scroll tracking at", dockStartScroll);
      }

      if (!currentlyDocked && isDocked) {
        isDocked = false;
      }
    });

    observer.observe(target, { attributes: true, attributeFilter: ["class"] });
    log("Docking observer attached.");
  });
}

// Continuously monitors a DOM node for the (re)insertion of an iframe.
// Once detected, it initializes the iframe by sending a postMessage,
// resets the current slide to 0, and attaches a MutationObserver to track 'src' changes.
function watchForIframeForever(nodeSelector) {
  const iframeSelector = `${nodeSelector} iframe`;
  waitForElement(nodeSelector, (root) => {
    const observer = new MutationObserver(() => {
      const iframe = root.querySelector(iframeSelector);
      if (iframe && !iframe.dataset.observed) {
        log(`Frame (re)found under ${nodeSelector}, attaching observer.`);
        iframe.dataset.observed = "true";
        currentSlide = 0;

        iframe.contentWindow.postMessage(
          {
            source: "storymap-controller",
            payload: { isEmbedded: true },
          },
          "*"
        );

        const srcObserver = createIframeSrcObserver(iframe);
        srcObserver.observe(iframe, {
          attributes: true,
          attributeFilter: ["src"],
          attributeOldValue: true,
        });
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    log(`Watching ${nodeSelector} for iframe (re)insertion.`);
  });
}

// --- Scroll tracking ---

// Attaches a scroll listener to track the user's scroll position and direction.
// When the target element is docked, it calculates the scroll progress of the current slide panel,
// logs the progress, and sends it to the embedded iframe via postMessage for synchronization.
function setupScrollListener(nodeSelector) {
  const iframeSelector = `${nodeSelector} iframe`;

  const throttledScrollHandler = throttle(() => {
    const currentScroll = window.scrollY;
    scrollDirection =
      currentScroll > lastScrollY
        ? "down"
        : currentScroll < lastScrollY
        ? "up"
        : scrollDirection;
    lastScrollY = currentScroll;

    if (!isDocked || dockStartScroll === null) return;

    const panels = document.querySelectorAll("div.immersive-narrative-panel");
    if (currentSlide < panels.length) {
      // Fallback: Check iframe src directly to update currentSlide
      const iframe = document.querySelector(iframeSelector);
      if (iframe) {
        const iframeSrc = iframe.getAttribute("src") || "";
        const parts = iframeSrc.split("#");
        const slideNumber = parseInt(parts.length > 1 ? parts.pop() : "0", 10);
        const detectedSlide = isNaN(slideNumber) ? 0 : slideNumber;
        if (detectedSlide !== currentSlide) {
          currentSlide = detectedSlide;
        }
      }
      
      const progress = getPanelProgress(panels, currentSlide, currentScroll);
      log("Scroll: [slide", currentSlide, "], [progress:", progress .toFixed(2) + "]")
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            source: "storymap-controller",
            payload: {
              type: "progress",
              slide: currentSlide, 
              progress: progress.toFixed(2),
              isEmbedded: true
            },
          },
          "*"
        );
      }
    }
  });

  window.addEventListener("scroll", throttledScrollHandler, { passive: true });
}

// --- Initialization ---

// Initializes the full scroll tracking system for a story map.
// Sets up observers for docking state, iframe (re)insertion and src changes,
// and attaches a scroll listener to track slide progress and sync it with the embedded iframe.
async function createStoryScrollListener(nodeSelector) {
  setupDockingObserver(nodeSelector);
  watchForIframeForever(nodeSelector);
  setupScrollListener(nodeSelector);
}

createStoryScrollListener(nodeConfig.nodeSelector)