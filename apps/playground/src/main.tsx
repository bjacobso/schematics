import "@vitejs/plugin-react/preamble";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PlaygroundApp from "./PlaygroundApp";
import "./styles.css";

// Astro loads this entry only for /playground or a hosted /w/{id} workspace.
document.title = "Schematics Playground";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlaygroundApp />
  </StrictMode>,
);
