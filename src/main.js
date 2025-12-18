import './style.css'
import simpleParallax from "simple-parallax-js/vanilla";

document.addEventListener('DOMContentLoaded', function() {
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