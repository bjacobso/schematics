import type { ComponentProps } from "react";
import Box from "@mui/material/Box";

export function ScrollArea({ className, ...props }: ComponentProps<"div">) {
  return <Box className={className} sx={{ overflow: "auto" }} {...props} />;
}
