import React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Bottom sheet used by every add/edit form for a consistent mobile feel.
 *
 * Layout: fixed drag-handle + header, independently scrollable body, and
 * safe-area-aware bottom padding so content is never hidden behind the
 * home indicator on notched / Dynamic-Island devices.
 */
export function FormSheet({ open, onOpenChange, title, description, children }: FormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-0 rounded-t-3xl border-border p-0"
      >
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-3" aria-hidden>
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Fixed header */}
        <SheetHeader className="shrink-0 px-5 pb-3 pt-3 text-left">
          <SheetTitle className="text-xl font-extrabold tracking-tight">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-[13px]">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[13px] font-bold text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Horizontal scrollable chip picker used for categories & options. */
export function ChipPicker<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  render?: (option: T) => React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all active:scale-95",
            value === option
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          {render ? render(option) : String(option)}
        </button>
      ))}
    </div>
  );
}
