import { cn } from "@/lib/utils";
import type { DocumentStatus, SubscriptionStatus } from "@/lib/types";

const DOC_STYLES: Record<DocumentStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success/12 text-success" },
  expiring: { label: "Expiring Soon", className: "bg-warning/15 text-warning" },
  expired: { label: "Expired", className: "bg-destructive/12 text-destructive" },
};

export function DocStatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const style = DOC_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
        style.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {style.label}
    </span>
  );
}

export function SubStatusBadge({ status }: { status: SubscriptionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold",
        status === "active" ? "bg-success/12 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      {status === "active" ? "Active" : "Cancelled"}
    </span>
  );
}
