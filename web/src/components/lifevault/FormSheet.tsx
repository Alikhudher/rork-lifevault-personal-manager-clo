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

/** Bottom sheet used by every add/edit form for a consistent mobile feel. */
export function FormSheet({ open, onOpenChange, title, description, children }: FormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-border px-5 pb-8 pt-5"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <SheetHeader className="mb-4 text-left">
          <SheetTitle className="text-xl font-extrabold tracking-tight">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-[13px]">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        {children}
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
