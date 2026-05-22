import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import { createContext, useContext, type ComponentProps } from "react";

export type SheetSide = "top" | "right" | "bottom" | "left";

export interface SheetProps extends ComponentProps<"div"> {
  readonly open: boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}

const SheetContext = createContext<Pick<SheetProps, "onOpenChange" | "open"> | null>(null);

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  return <SheetContext.Provider value={{ open, onOpenChange }}>{children}</SheetContext.Provider>;
}

export interface SheetContentProps extends ComponentProps<"section"> {
  readonly side?: SheetSide | undefined;
}

export function SheetContent({ side = "right", className, children, ...props }: SheetContentProps) {
  const context = useContext(SheetContext);
  const open = context?.open ?? false;
  const onOpenChange = context?.onOpenChange;

  return (
    <Drawer anchor={side} open={open} onClose={() => onOpenChange?.(false)}>
      <Box
        className={className}
        component="section"
        role="dialog"
        sx={{
          display: "flex",
          flexDirection: "column",
          height: side === "left" || side === "right" ? "100%" : "auto",
          maxHeight: side === "top" || side === "bottom" ? "85vh" : undefined,
          maxWidth: side === "left" || side === "right" ? 448 : undefined,
          minWidth: side === "left" || side === "right" ? { xs: "100vw", sm: 448 } : undefined,
          width: side === "top" || side === "bottom" ? "100vw" : undefined,
        }}
        {...props}
      >
        {children}
      </Box>
    </Drawer>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <Box
      className={className}
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        p: 2,
      }}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<"h2">) {
  return <Typography className={className} component="h2" variant="subtitle1" {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <Typography
      className={className}
      color="text.secondary"
      component="p"
      variant="body2"
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return <Box className={className} sx={{ flex: 1, minHeight: 0, overflow: "auto" }} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <Box
      className={className}
      sx={{
        alignItems: "center",
        borderColor: "divider",
        borderTop: 1,
        display: "flex",
        gap: 1,
        justifyContent: "flex-end",
        p: 2,
      }}
      {...props}
    />
  );
}
