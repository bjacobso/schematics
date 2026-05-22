import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useMemo, type ReactNode } from "react";

export type SchemaIdeThemeMode = "dark" | "light";

export interface SchemaIdeThemeProviderProps {
  readonly children: ReactNode;
  readonly mode?: SchemaIdeThemeMode | undefined;
}

export function createSchemaIdeTheme(mode: SchemaIdeThemeMode = "light") {
  return createTheme({
    palette: {
      mode,
    },
  });
}

export function SchemaIdeThemeProvider({ children, mode = "light" }: SchemaIdeThemeProviderProps) {
  const theme = useMemo(() => createSchemaIdeTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
