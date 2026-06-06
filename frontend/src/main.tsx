import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

// bpmn-js full editor styles (palette, context-pad, popup-menu, icons)
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js/dist/assets/bpmn-js.css";
// Camunda-style properties panel (oficial de bpmn-io / camunda)
import "@bpmn-io/properties-panel/assets/properties-panel.css";
// Minimap + color picker (oficiales del ecosistema bpmn-io)
import "diagram-js-minimap/assets/diagram-js-minimap.css";
import "bpmn-js-color-picker/colors/color-picker.css";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
