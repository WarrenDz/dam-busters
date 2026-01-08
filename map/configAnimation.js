// config object to hold all variables
export const animationConfig = {
  maps: [
    { type: "webmap", itemId: "1fc0bb05f53847d98f2d3deb75ff7418", container: "mapContainer" },
    { type: "webscene", itemId: "71315cdaeb564b79bfd7b8250ff5d39a", container: "sceneContainer" }
  ],
  zoom: "4",
  center: "-0.551002, 53.307870",
  timePlayRate: "250",
  debugMode: true,
  disableMapNav: true,
  mapFit: "extent",
  mapChoreography: "../mapChoreography.json",
  goToConfig: {animate: true, duration: 1000}
};