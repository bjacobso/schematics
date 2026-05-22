import Chip from "@mui/material/Chip";
import type { ComponentProps } from "react";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const chipColor: Record<BadgeVariant, "primary" | "secondary" | "error" | "default"> = {
  default: "primary",
  secondary: "secondary",
  destructive: "error",
  outline: "default",
};

export interface BadgeProps extends Omit<ComponentProps<"span">, "color"> {
  readonly variant?: BadgeVariant | undefined;
}

export function Badge({ children, className, variant = "default", ...props }: BadgeProps) {
  return (
    <Chip
      className={className}
      color={chipColor[variant]}
      component="span"
      label={children}
      size="small"
      variant={variant === "outline" ? "outlined" : "filled"}
      {...props}
    />
  );
}
