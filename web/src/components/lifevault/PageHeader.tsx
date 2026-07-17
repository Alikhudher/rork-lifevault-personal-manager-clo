import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, back, actions, className }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/60 bg-background/85 px-4 pb-3 pt-4 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {back && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
