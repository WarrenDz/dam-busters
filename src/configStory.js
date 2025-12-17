function generateScriptConfig() {
  window.storyMapsEmbedConfig = {
      storyId: "651e46084fe14efc88fd63a92ce6cc43",
      rootNode: ".storymaps-root",
  };
}

function createScriptedEmbed() {
  const script = document.createElement('script');
  script.id = 'embed-script';
  script.src = `https://storymaps.arcgis.com/embed/view`;
  document.body.appendChild(script);
}

generateScriptConfig();
createScriptedEmbed();