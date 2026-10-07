import { CircleAlert, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StateMessageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

function EmptyState({ title, description, icon: Icon = Inbox, action, className }: StateMessageProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("grid justify-items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-10 text-center", className)}
    >
      <Icon aria-hidden="true" className="size-8 text-primary" />
      <h3 className="m-0 font-display text-headline-md font-bold uppercase">{title}</h3>
      {description ? <p className="m-0 max-w-sm text-body text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function ErrorState({ title, description, icon: Icon = CircleAlert, action, className }: StateMessageProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn("grid justify-items-center gap-2 rounded-lg border border-danger bg-danger-soft px-4 py-10 text-center", className)}
    >
      <Icon aria-hidden="true" className="size-8 text-danger-text" />
      <h3 className="m-0 font-display text-headline-md font-bold uppercase">{title}</h3>
      {description ? <p className="m-0 max-w-sm text-body text-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState, ErrorState };
