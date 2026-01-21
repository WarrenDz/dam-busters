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

import './style.css'
import simpleParallax from "simple-parallax-js/vanilla";

// Global error handler to prevent crashes
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', message, 'at', source, lineno, colno, error);
    // Optionally, send to analytics or handle gracefully
    return true; // Prevent default handling
};

document.addEventListener('DOMContentLoaded', function() {
    // Skip parallax on mobile devices to improve performance
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (isMobile) return;

    // Background layer (slowest movement)
    new simpleParallax(document.getElementById('scene-layer1'), {
        scale: 0.1,
        delay: 0.5,
        transition: 'cubic-bezier(0,0,0,1)',
        overflow: true
    });

    // Midground layer
    new simpleParallax(document.getElementById('scene-layer2'), {
        scale: 0.25,
        delay: 0.5,
        transition: 'cubic-bezier(0,0,0,1)',
        overflow: true
    });

    // Foreground layer
    new simpleParallax(document.getElementById('scene-layer3'), {
        scale: 0.5,
        delay: 0.5,
        transition: 'cubic-bezier(0,0,0,1)',
        overflow: true
    });

    // Top layer (fastest movement)
    new simpleParallax(document.getElementById('scene-layer4'), {
        scale: 1,
        delay: 0.5,
        transition: 'cubic-bezier(0,0,0,1)',
        overflow: true
    });
});