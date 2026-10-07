import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold uppercase tracking-[0.05em] transition-[background-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary-hover hover:shadow-glow disabled:hover:bg-primary disabled:hover:shadow-none",
        secondary: "border-[1.5px] border-secondary bg-transparent text-foreground hover:bg-accent-soft active:bg-accent-soft",
        ghost: "bg-transparent text-foreground hover:bg-surface-high",
        destructive: "bg-danger text-on-primary hover:brightness-110"
      },
      size: {
        default: "min-h-12 px-7 py-3 text-label",
        sm: "min-h-tap px-4 py-2 text-body-sm",
        lg: "min-h-14 px-8 py-3 text-body-lg",
        icon: "size-tap"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));
  if (asChild) {
    return <Slot data-slot="button" className={classes} {...props}>{children}</Slot>;
  }
  return (
    <button data-slot="button" aria-busy={loading || undefined} className={classes} disabled={disabled || loading} {...props}>
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
