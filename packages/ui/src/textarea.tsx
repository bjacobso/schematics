import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";

export type TextareaProps = Omit<TextFieldProps, "multiline">;

export function Textarea({ className, ...props }: TextareaProps) {
  return <TextField className={className} fullWidth multiline size="small" {...props} />;
}
