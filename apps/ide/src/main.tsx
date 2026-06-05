import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { createSchematicsChatAdapter } from "@schematics/agent";
import { createRpcArtifactProjectClient, SchematicsArtifactProjectView } from "@schematics/ide";
import "./styles.css";

function App() {
  const apiBaseUrl = import.meta.env["VITE_SCHEMATICS_API_BASE_URL"] ?? "";
  const artifactProject = useMemo(() => createRpcArtifactProjectClient(apiBaseUrl), [apiBaseUrl]);
  const chat = useMemo(() => createSchematicsChatAdapter({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: "light",
          primary: { main: "#0b5cad" },
          secondary: { main: "#5f9ea6" },
          background: { default: "#f6f8fb", paper: "#ffffff" },
        },
        shape: { borderRadius: 6 },
      }),
    [],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SchematicsArtifactProjectView
        artifactProject={artifactProject}
        chat={chat}
        defaultMode="code"
        showDebug={false}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
