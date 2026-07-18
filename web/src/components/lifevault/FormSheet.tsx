import React, { useCallback, useEffect, useRef, useState } from "react";
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
 * How far (in px) the on-screen keyboard intrudes from the bottom of the
 * layout viewport. Returns 0 when no keyboard is visible.
 *
 * In iOS WKWebView (Capacitor) the keyboard overlays the layout viewport
 * instead of resizing it, so `window.innerHeight` is useless for detecting
 * it. `visualViewport` reports the visible (un-occluded) region and is the
 * reliable signal across iOS Safari, WKWebView, and Android Chrome.
 */
function getKeyboardInset(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/**
 * Bottom sheet used by every add/edit form for a consistent mobile feel.
 *
 * Layout: fixed drag-handle + header, independently scrollable body, and
 * safe-area-aware bottom padding so content is never hidden behind the
 * home indicator on notched / Dynamic-Island devices.
 *
 * Keyboard handling: when the soft keyboard appears (iOS WKWebView overlays
 * the viewport rather than resizing it), the sheet is translated up by the
 * keyboard's height so the focused input stays visible. The active input is
 * also scrolled into view once the sheet has lifted.
 */
export function FormSheet({ open, onOpenChange, title, description, children }: FormSheetProps) {
  const [keyboardInset, setKeyboardInset] = useState<number>(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Track the on-screen keyboard via visualViewport. Only the open sheet
  // subscribes, so closed sheets pay no cost.
  useEffect(() => {
    if (!open) {
      setKeyboardInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setKeyboardInset(getKeyboardInset());
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("keyboardWillShow", update as EventListener);
    window.addEventListener("keyboardDidShow", update as EventListener);
    window.addEventListener("keyboardWillHide", update as EventListener);
    window.addEventListener("keyboardDidHide", update as EventListener);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("keyboardWillShow", update as EventListener);
      window.removeEventListener("keyboardDidShow", update as EventListener);
      window.removeEventListener("keyboardWillHide", update as EventListener);
      window.removeEventListener("keyboardDidHide", update as EventListener);
    };
  }, [open]);

  // When the keyboard appears, scroll the focused input into view inside
  // the sheet body so it isn't hidden behind the keyboard or the header.
  useEffect(() => {
    if (!open || keyboardInset <= 0) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && bodyRef.current?.contains(el)) {
      // Defer until the translate transform has been applied.
      const id = window.requestAnimationFrame(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [open, keyboardInset]);

  const handleRef = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node;
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-0 rounded-t-3xl border-border p-0 transition-transform will-change-transform"
        style={{ transform: keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined }}
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
          ref={handleRef}
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
