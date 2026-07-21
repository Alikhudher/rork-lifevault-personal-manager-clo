import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { subscribeKeyboard } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /**
   * Optional pinned footer. It renders below the scrollable body at the very
   * bottom of the sheet — and because the whole sheet is lifted above the
   * soft keyboard, the footer sits directly ON TOP of the keyboard while it
   * is open (perfect for an iOS-style "Done" accessory bar).
   */
  footer?: React.ReactNode;
}

/**
 * Bottom sheet used by every add/edit form for a consistent mobile feel.
 *
 * Layout: fixed drag-handle + header, independently scrollable body, and
 * safe-area-aware bottom padding so content is never hidden behind the home
 * indicator on notched / Dynamic-Island devices.
 *
 * Keyboard handling: when the soft keyboard appears (iOS WKWebView overlays
 * the viewport rather than resizing it), the sheet is raised above the
 * keyboard AND its max-height is clamped to the visible viewport so the top
 * of the sheet never scrolls off-screen. The focused input is then scrolled
 * into view inside the sheet body. Keyboard tracking comes from the central
 * manager in `@/lib/keyboard` (native Capacitor events + visualViewport).
 */
export function FormSheet({ open, onOpenChange, title, description, children, footer }: FormSheetProps) {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 0,
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Track the on-screen keyboard via the shared manager. Only the open sheet
  // subscribes, so closed sheets pay no cost.
  useEffect(() => {
    if (!open) {
      setKeyboardHeight(0);
      return;
    }
    return subscribeKeyboard((state) => {
      setKeyboardHeight(state.inset);
      setViewportHeight(state.viewportHeight);
    });
  }, [open]);

  // When the keyboard appears or focus changes while it's open, scroll the
  // focused input into view inside the sheet body so it isn't hidden behind
  // the keyboard or the header. Uses a small extra top margin so the field
  // sits clearly above the keyboard, not flush against it.
  const scrollFocusedIntoView = useCallback(() => {
    if (!open || keyboardHeight <= 0) return;
    const el = document.activeElement;
    const body = bodyRef.current;
    if (!(el instanceof HTMLElement) || !body || !body.contains(el)) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, keyboardHeight]);

  useEffect(() => {
    return scrollFocusedIntoView();
  }, [scrollFocusedIntoView]);

  // Re-run when focus moves between fields while the keyboard is already up.
  useEffect(() => {
    if (!open || keyboardHeight <= 0) return;
    const body = bodyRef.current;
    if (!body) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !body.contains(target)) return;
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, keyboardHeight]);

  const handleRef = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node;
  }, []);

  const raised = keyboardHeight > 0;
  // Small breathing room above the keyboard so the focused field is clearly
  // visible and not flush against the top of the keyboard.
  const liftMargin = 12;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex w-full max-w-md flex-col gap-0 rounded-t-3xl border-border p-0"
        style={{
          // Raise the sheet above the keyboard by moving its anchored bottom
          // edge (NOT a transform — the open/close slide animation also
          // animates transform and would override an inline transform on
          // real devices, leaving the sheet behind the keyboard), and clamp
          // its height to the visible area so the header never scrolls away
          // and the body stays scrollable on small iPhones.
          bottom: raised ? keyboardHeight + liftMargin : 0,
          maxHeight: raised ? `${Math.max(240, viewportHeight - liftMargin - 8)}px` : "92dvh",
          transition: "bottom 0.25s ease, max-height 0.25s ease",
        }}
      >
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-3" aria-hidden>
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Fixed header */}
        <SheetHeader className="shrink-0 px-5 pb-3 pt-3 text-start">
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
          className={cn(
            "flex-1 overflow-y-auto overscroll-contain px-5",
            footer ? "pb-4" : "pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]",
          )}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>

        {/* Pinned footer — sits right above the keyboard when it's open. */}
        {footer ? (
          <div
            className="shrink-0 border-t border-border/60 bg-card px-5 pt-3"
            style={{
              paddingBottom: raised ? 12 : "calc(env(safe-area-inset-bottom, 0px) + 12px)",
            }}
          >
            {footer}
          </div>
        ) : null}
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
