import { alpha, createTheme } from "@mui/material/styles";

export type PlaygroundThemeMode = "dark" | "light";
export type PlaygroundThemeFamily = "blueprint" | "neutral" | "stripe" | "material";
export type PlaygroundRadius = "compact" | "soft" | "round";

export interface PlaygroundThemeSettings {
  readonly family: PlaygroundThemeFamily;
  readonly mode: PlaygroundThemeMode;
  readonly radius: PlaygroundRadius;
}

export const defaultPlaygroundThemeSettings: PlaygroundThemeSettings = {
  family: "blueprint",
  mode: "light",
  radius: "soft",
};

export const playgroundThemeFamilyOptions: ReadonlyArray<{
  readonly id: PlaygroundThemeFamily;
  readonly label: string;
}> = [
  { id: "blueprint", label: "Blueprint" },
  { id: "neutral", label: "Neutral" },
  { id: "stripe", label: "Stripe" },
  { id: "material", label: "Material You" },
];

export const playgroundRadiusOptions: ReadonlyArray<{
  readonly id: PlaygroundRadius;
  readonly label: string;
  readonly cssRadius: string;
  readonly muiRadius: number;
}> = [
  { id: "compact", label: "Compact", cssRadius: "0.25rem", muiRadius: 4 },
  { id: "soft", label: "Soft", cssRadius: "0.5rem", muiRadius: 8 },
  { id: "round", label: "Round", cssRadius: "0.875rem", muiRadius: 14 },
];

interface PlaygroundPalette {
  readonly background: string;
  readonly card: string;
  readonly chart2: string;
  readonly chart3: string;
  readonly chart4: string;
  readonly foreground: string;
  readonly input: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly popover: string;
  readonly primary: string;
  readonly primaryContainer: string;
  readonly primaryForeground: string;
  readonly ring: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly surface: string;
  readonly surfaceContainer: string;
  readonly surfaceContainerHigh: string;
  readonly surfaceContainerHighest: string;
  readonly surfaceContainerLow: string;
  readonly border: string;
  readonly destructive: string;
}

const palettes: Record<PlaygroundThemeFamily, Record<PlaygroundThemeMode, PlaygroundPalette>> = {
  blueprint: {
    light: {
      background: "#f6f8fb",
      card: "#ffffff",
      chart2: "#5f9ea6",
      chart3: "#7e8dd6",
      chart4: "#d6994f",
      foreground: "#1c2127",
      input: "#c7d0dc",
      muted: "#eef2f6",
      mutedForeground: "#657282",
      popover: "#ffffff",
      primary: "#0b5cad",
      primaryContainer: "#d7e7ff",
      primaryForeground: "#ffffff",
      ring: "#4b8fd8",
      secondary: "#4f5f72",
      secondaryForeground: "#ffffff",
      surface: "#fbfcfe",
      surfaceContainer: "#eef3f8",
      surfaceContainerHigh: "#e5ebf2",
      surfaceContainerHighest: "#dae2ec",
      surfaceContainerLow: "#f5f7fa",
      border: "#d4dce7",
      destructive: "#c23030",
    },
    dark: {
      background: "#11161d",
      card: "#171d25",
      chart2: "#5f9ea6",
      chart3: "#7e8dd6",
      chart4: "#d6994f",
      foreground: "#e8edf3",
      input: "#3a4654",
      muted: "#202833",
      mutedForeground: "#9caaba",
      popover: "#1b222c",
      primary: "#8ab4f8",
      primaryContainer: "#17385f",
      primaryForeground: "#07111f",
      ring: "#6ea2e6",
      secondary: "#aab6c5",
      secondaryForeground: "#101820",
      surface: "#151b23",
      surfaceContainer: "#1b232d",
      surfaceContainerHigh: "#222b36",
      surfaceContainerHighest: "#2a3541",
      surfaceContainerLow: "#131920",
      border: "#303b48",
      destructive: "#ff8a80",
    },
  },
  neutral: {
    light: {
      background: "#f7f7f8",
      card: "#ffffff",
      chart2: "#737373",
      chart3: "#a1a1aa",
      chart4: "#d4a373",
      foreground: "#18181b",
      input: "#d7d7dd",
      muted: "#f1f1f2",
      mutedForeground: "#71717a",
      popover: "#ffffff",
      primary: "#18181b",
      primaryContainer: "#ececee",
      primaryForeground: "#ffffff",
      ring: "#8e8e93",
      secondary: "#52525b",
      secondaryForeground: "#ffffff",
      surface: "#fcfcfd",
      surfaceContainer: "#f1f1f2",
      surfaceContainerHigh: "#e8e8eb",
      surfaceContainerHighest: "#dedee3",
      surfaceContainerLow: "#f7f7f8",
      border: "#dedee3",
      destructive: "#d92d20",
    },
    dark: {
      background: "#0b0b0c",
      card: "#111113",
      chart2: "#a1a1aa",
      chart3: "#71717a",
      chart4: "#d4a373",
      foreground: "#f4f4f5",
      input: "#333338",
      muted: "#1c1c1f",
      mutedForeground: "#a1a1aa",
      popover: "#18181b",
      primary: "#f4f4f5",
      primaryContainer: "#242428",
      primaryForeground: "#18181b",
      ring: "#71717a",
      secondary: "#d4d4d8",
      secondaryForeground: "#18181b",
      surface: "#111113",
      surfaceContainer: "#18181b",
      surfaceContainerHigh: "#202024",
      surfaceContainerHighest: "#2a2a2e",
      surfaceContainerLow: "#0f0f11",
      border: "#2a2a2e",
      destructive: "#ff6b5f",
    },
  },
  stripe: {
    light: {
      background: "#f7f5f2",
      card: "#ffffff",
      chart2: "#00a88f",
      chart3: "#f6a03d",
      chart4: "#e65f8e",
      foreground: "#1d1b20",
      input: "#d8d2ca",
      muted: "#efede9",
      mutedForeground: "#6f6a63",
      popover: "#ffffff",
      primary: "#635bff",
      primaryContainer: "#ebe9ff",
      primaryForeground: "#ffffff",
      ring: "#7c72ff",
      secondary: "#3f3b53",
      secondaryForeground: "#ffffff",
      surface: "#fffefd",
      surfaceContainer: "#efede9",
      surfaceContainerHigh: "#e8e3dc",
      surfaceContainerHighest: "#ded9d1",
      surfaceContainerLow: "#f7f5f2",
      border: "#ded9d1",
      destructive: "#d92d20",
    },
    dark: {
      background: "#101014",
      card: "#17171d",
      chart2: "#44d7b6",
      chart3: "#ffb86b",
      chart4: "#ff7fab",
      foreground: "#f5f3ef",
      input: "#3c3747",
      muted: "#232229",
      mutedForeground: "#aaa4b2",
      popover: "#1b1a22",
      primary: "#9b8cff",
      primaryContainer: "#272145",
      primaryForeground: "#151124",
      ring: "#a99cff",
      secondary: "#c9c1df",
      secondaryForeground: "#17131f",
      surface: "#17171d",
      surfaceContainer: "#1d1c24",
      surfaceContainerHigh: "#25232d",
      surfaceContainerHighest: "#302d38",
      surfaceContainerLow: "#14141a",
      border: "#302d38",
      destructive: "#ff7a70",
    },
  },
  material: {
    light: {
      background: "#faf8f4",
      card: "#ffffff",
      chart2: "#006b5f",
      chart3: "#7d5260",
      chart4: "#b36b00",
      foreground: "#1f1b16",
      input: "#d8d2c8",
      muted: "#f0eee8",
      mutedForeground: "#746d64",
      popover: "#fffdf8",
      primary: "#6750a4",
      primaryContainer: "#eaddff",
      primaryForeground: "#ffffff",
      ring: "#7d6bb3",
      secondary: "#625b71",
      secondaryForeground: "#ffffff",
      surface: "#fffdf8",
      surfaceContainer: "#f0eee8",
      surfaceContainerHigh: "#e9e4da",
      surfaceContainerHighest: "#ded8cf",
      surfaceContainerLow: "#f7f3ec",
      border: "#ded8cf",
      destructive: "#ba1a1a",
    },
    dark: {
      background: "#141218",
      card: "#1d1b20",
      chart2: "#4fd8c4",
      chart3: "#efb8c8",
      chart4: "#ffc680",
      foreground: "#e7e1e8",
      input: "#4a4454",
      muted: "#27232c",
      mutedForeground: "#cac4cf",
      popover: "#211f26",
      primary: "#d0bcff",
      primaryContainer: "#4f378b",
      primaryForeground: "#381e72",
      ring: "#d0bcff",
      secondary: "#ccc2dc",
      secondaryForeground: "#332d41",
      surface: "#1d1b20",
      surfaceContainer: "#211f26",
      surfaceContainerHigh: "#2b2930",
      surfaceContainerHighest: "#36313d",
      surfaceContainerLow: "#1a181d",
      border: "#36313d",
      destructive: "#ffb4ab",
    },
  },
};

function getRadius(radius: PlaygroundRadius) {
  return (
    playgroundRadiusOptions.find((option) => option.id === radius) ??
    playgroundRadiusOptions.find((option) => option.id === defaultPlaygroundThemeSettings.radius)!
  );
}

function getPalette(settings: PlaygroundThemeSettings) {
  return palettes[settings.family][settings.mode];
}

export function getPlaygroundCssVariables(
  settings: PlaygroundThemeSettings,
): Record<string, string> {
  const palette = getPalette(settings);
  const radius = getRadius(settings.radius);
  return {
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--card": palette.card,
    "--card-foreground": palette.foreground,
    "--popover": palette.popover,
    "--popover-foreground": palette.foreground,
    "--primary": palette.primary,
    "--primary-foreground": palette.primaryForeground,
    "--secondary": palette.surfaceContainerHigh,
    "--secondary-foreground": palette.foreground,
    "--muted": palette.muted,
    "--muted-foreground": palette.mutedForeground,
    "--accent": palette.primaryContainer,
    "--accent-foreground": palette.foreground,
    "--destructive": palette.destructive,
    "--border": palette.border,
    "--input": palette.input,
    "--ring": palette.ring,
    "--chart-1": palette.primary,
    "--chart-2": palette.chart2,
    "--chart-3": palette.chart3,
    "--chart-4": palette.chart4,
    "--chart-5": palette.destructive,
    "--sidebar": palette.surfaceContainer,
    "--sidebar-foreground": palette.foreground,
    "--sidebar-primary": palette.primary,
    "--sidebar-primary-foreground": palette.primaryForeground,
    "--sidebar-accent": palette.surfaceContainerHigh,
    "--sidebar-accent-foreground": palette.foreground,
    "--sidebar-border": palette.border,
    "--sidebar-ring": palette.ring,
    "--radius": radius.cssRadius,
  };
}

export function applyPlaygroundThemeSettings(settings: PlaygroundThemeSettings) {
  document.documentElement.dataset["theme"] = settings.mode;
  document.documentElement.dataset["themeFamily"] = settings.family;
  document.documentElement.dataset["radius"] = settings.radius;
  document.documentElement.classList.toggle("dark", settings.mode === "dark");
  document.documentElement.style.colorScheme = settings.mode;
  const variables = getPlaygroundCssVariables(settings);
  for (const [name, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(name, value);
  }
}

export function createPlaygroundTheme(settings: PlaygroundThemeSettings) {
  const palette = getPalette(settings);
  const radius = getRadius(settings.radius).muiRadius;
  const controlRadius = Math.max(4, radius - 2);
  const menuItemRadius = Math.max(3, radius - 3);
  const isDark = settings.mode === "dark";
  const hover = alpha(palette.primary, isDark ? 0.16 : 0.08);
  const selected = alpha(palette.primary, isDark ? 0.24 : 0.14);

  return createTheme({
    palette: {
      mode: settings.mode,
      primary: {
        main: palette.primary,
        contrastText: palette.primaryForeground,
      },
      secondary: {
        main: palette.secondary,
        contrastText: palette.secondaryForeground,
      },
      error: {
        main: palette.destructive,
      },
      background: {
        default: palette.background,
        paper: palette.card,
      },
      divider: palette.border,
      text: {
        primary: palette.foreground,
        secondary: palette.mutedForeground,
      },
      action: {
        hover,
        selected,
        focus: alpha(palette.ring, 0.24),
        disabled: alpha(palette.foreground, 0.34),
        disabledBackground: alpha(palette.foreground, 0.08),
      },
    },
    shape: {
      borderRadius: radius,
    },
    spacing: 4,
    typography: {
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: 13,
      htmlFontSize: 16,
      h1: { fontSize: 24, fontWeight: 650, lineHeight: 1.2 },
      h2: { fontSize: 20, fontWeight: 650, lineHeight: 1.25 },
      h3: { fontSize: 17, fontWeight: 650, lineHeight: 1.3 },
      h4: { fontSize: 15, fontWeight: 650, lineHeight: 1.35 },
      h5: { fontSize: 14, fontWeight: 650, lineHeight: 1.4 },
      h6: { fontSize: 13, fontWeight: 650, lineHeight: 1.4 },
      body1: { fontSize: 13, lineHeight: 1.45 },
      body2: { fontSize: 12, lineHeight: 1.4 },
      button: { fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "none" },
      caption: { fontSize: 11, lineHeight: 1.35 },
      overline: { fontSize: 10, fontWeight: 650, letterSpacing: 0, textTransform: "uppercase" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: palette.background,
            color: palette.foreground,
            fontSize: 13,
          },
          "::selection": {
            backgroundColor: alpha(palette.primary, 0.24),
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
          size: "small",
        },
        styleOverrides: {
          root: {
            borderRadius: controlRadius,
            minHeight: 28,
            padding: "3px 10px",
          },
          sizeSmall: {
            minHeight: 26,
            padding: "2px 8px",
          },
          containedPrimary: {
            backgroundColor: palette.primary,
          },
          outlined: {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            color: palette.foreground,
            "&:hover": {
              backgroundColor: hover,
              borderColor: palette.ring,
            },
          },
          text: {
            color: palette.foreground,
            "&:hover": {
              backgroundColor: hover,
            },
          },
        },
      },
      MuiIconButton: {
        defaultProps: {
          size: "small",
        },
        styleOverrides: {
          root: {
            borderRadius: controlRadius,
            height: 28,
            padding: 4,
            width: 28,
            "&:hover": {
              backgroundColor: hover,
            },
          },
          sizeMedium: {
            height: 30,
            width: 30,
          },
        },
      },
      MuiChip: {
        defaultProps: {
          size: "small",
        },
        styleOverrides: {
          root: {
            borderRadius: controlRadius,
            fontSize: 11,
            fontWeight: 600,
            height: 20,
          },
          label: {
            paddingLeft: 6,
            paddingRight: 6,
          },
          outlined: {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
          filledSecondary: {
            backgroundColor: palette.surfaceContainerHighest,
            color: palette.foreground,
          },
        },
      },
      MuiFormControl: {
        defaultProps: {
          margin: "dense",
          size: "small",
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: {
            fontSize: 12,
          },
          input: {
            paddingBottom: 5,
            paddingTop: 5,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: palette.surface,
            borderRadius: controlRadius,
            minHeight: 30,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: palette.border,
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: palette.ring,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: palette.ring,
              borderWidth: 1,
              boxShadow: `0 0 0 2px ${alpha(palette.ring, 0.18)}`,
            },
          },
          input: {
            padding: "5px 8px",
          },
        },
      },
      MuiSelect: {
        defaultProps: {
          size: "small",
        },
        styleOverrides: {
          select: {
            minHeight: "unset",
            paddingBottom: 5,
            paddingTop: 5,
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          elevation: 2,
        },
        styleOverrides: {
          paper: {
            backgroundColor: palette.popover,
            border: `1px solid ${palette.border}`,
            borderRadius: radius,
          },
          list: {
            paddingBottom: 4,
            paddingTop: 4,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: menuItemRadius,
            fontSize: 12,
            marginLeft: 4,
            marginRight: 4,
            minHeight: 28,
            paddingBottom: 4,
            paddingTop: 4,
            "&.Mui-selected": {
              backgroundColor: selected,
            },
            "&.Mui-selected:hover": {
              backgroundColor: alpha(palette.primary, isDark ? 0.3 : 0.18),
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: palette.surface,
            borderRadius: controlRadius,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: palette.border,
            borderRadius: controlRadius,
            color: palette.foreground,
            fontSize: 12,
            minHeight: 28,
            padding: "3px 9px",
            textTransform: "none",
            "&.Mui-selected": {
              backgroundColor: selected,
              color: palette.foreground,
            },
            "&.Mui-selected:hover": {
              backgroundColor: alpha(palette.primary, isDark ? 0.3 : 0.18),
            },
          },
        },
      },
      MuiCheckbox: {
        defaultProps: {
          size: "small",
        },
        styleOverrides: {
          root: {
            padding: 4,
          },
        },
      },
      MuiFormControlLabel: {
        styleOverrides: {
          root: {
            marginLeft: -4,
            marginRight: 0,
          },
          label: {
            fontSize: 12,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          margin: "dense",
          size: "small",
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.card,
            borderColor: palette.border,
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
          outlined: {
            borderColor: palette.border,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: controlRadius,
            fontSize: 11,
          },
        },
      },
    },
  });
}
