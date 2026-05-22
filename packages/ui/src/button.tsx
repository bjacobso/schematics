import type { ComponentProps } from "react";
import MuiButton from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "default" | "sm" | "icon" | "icon-xs";

const muiVariant: Record<ButtonVariant, "contained" | "outlined" | "text"> = {
  default: "contained",
  outline: "outlined",
  secondary: "contained",
  ghost: "text",
  destructive: "contained",
};

const muiColor: Record<ButtonVariant, "primary" | "secondary" | "error" | "inherit"> = {
  default: "primary",
  outline: "primary",
  secondary: "secondary",
  ghost: "inherit",
  destructive: "error",
};

export interface ButtonProps extends Omit<ComponentProps<"button">, "color"> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  if (size === "icon" || size === "icon-xs") {
    return (
      <IconButton
        className={className}
        color={muiColor[variant]}
        disabled={props.disabled}
        size={size === "icon-xs" ? "small" : "medium"}
        type={type}
        sx={variant === "outline" ? { border: 1, borderColor: "divider" } : undefined}
        {...props}
      />
    );
  }

  return (
    <MuiButton
      type={type}
      className={className}
      color={muiColor[variant]}
      size={size === "sm" ? "small" : "medium"}
      variant={muiVariant[variant]}
      {...props}
    />
  );
}
