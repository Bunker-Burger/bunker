import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "w-full min-w-0 rounded-md border border-border-strong bg-field px-3 text-body-lg text-foreground transition-[border-color,box-shadow] focus-visible:border-primary focus-visible:shadow-[0_0_0_1px_var(--color-primary)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus-visible:shadow-[0_0_0_1px_var(--color-danger)]";

function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(fieldClasses, "min-h-12 py-2", className)} {...props} />;
}

export { fieldClasses, Input };
