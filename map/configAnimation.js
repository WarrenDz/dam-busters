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

// config object to hold all variables
export const animationConfig = {
  maps: [
    { type: "webmap", itemId: "1fc0bb05f53847d98f2d3deb75ff7418", container: "mapContainer" },
    { type: "webscene", itemId: "71315cdaeb564b79bfd7b8250ff5d39a", container: "sceneContainer" }
  ],
  zoom: "4",
  center: "-0.551002, 53.307870",
  timePlayRate: "250",
  debugMode: false,
  disableMapNav: true,
  mapFit: "extent",
  mapChoreography: "../mapChoreography.json",
  goToConfig: {animate: true, duration: 1000}
};