import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Keyboard } from "@capacitor/keyboard";
import { cn } from "@/lib/utils";

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Height of the on-screen keyboard in CSS pixels. Returns 0 when no keyboard
 * is visible.
 *
 * In iOS WKWebView (Capacitor) the keyboard overlays the layout viewport
 * instead of resizing it, so `window.innerHeight` stays constant while the
 * keyboard is up. `visualViewport` reports the visible (un-occluded) region
 * and is the reliable cross-platform signal.
 */
function keyboardInsetFromViewport(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
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
 * into view inside the sheet body.
 *
 * Two signals are combined for reliability:
 *  - @capacitor/keyboard events (native iOS/Android — exact keyboard height)
 *  - visualViewport resize/scroll (web + fallback)
 */
export function FormSheet({ open, onOpenChange, title, description, children }: FormSheetProps) {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 0,
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Track the on-screen keyboard. Only the open sheet subscribes, so closed
  // sheets pay no cost.
  useEffect(() => {
    if (!open) {
      setKeyboardHeight(0);
      return;
    }

    let kapShow: { remove: () => void } | undefined;
    let kapHide: { remove: () => void } | undefined;

    const updateFromViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      setViewportHeight(vv.height);
      setKeyboardHeight(keyboardInsetFromViewport());
    };

    // Native keyboard events (Capacitor). These fire reliably inside the
    // iOS WKWebView where visualViewport can be delayed or batched.
    try {
      Keyboard.addListener("keyboardWillShow", (info) => {
        setKeyboardHeight(info.keyboardHeight);
        // With resize:none, window.innerHeight stays at the full size while
        // the keyboard overlays it. visualViewport.height is the un-occluded
        // height — use it so the sheet's max-height fits the visible area.
        const vv = window.visualViewport;
        setViewportHeight(vv ? vv.height : Math.max(0, window.innerHeight - info.keyboardHeight));
      }).then((h) => {
        kapShow = h;
      });
      Keyboard.addListener("keyboardWillHide", () => {
        setKeyboardHeight(0);
        if (typeof window !== "undefined") setViewportHeight(window.innerHeight);
      }).then((h) => {
        kapHide = h;
      });
    } catch {
      // Keyboard plugin not available (pure web) — visualViewport below covers it.
    }

    const vv = window.visualViewport;
    updateFromViewport();
    if (vv) {
      vv.addEventListener("resize", updateFromViewport);
      vv.addEventListener("scroll", updateFromViewport);
    }

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateFromViewport);
        vv.removeEventListener("scroll", updateFromViewport);
      }
      kapShow?.remove();
      kapHide?.remove();
    };
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
          // Raise the sheet above the keyboard and clamp its height to the
          // visible (un-occluded) viewport so the header never scrolls away.
          transform: raised ? `translateY(-${keyboardHeight + liftMargin}px)` : undefined,
          maxHeight: raised ? `${Math.max(0, viewportHeight - liftMargin)}px` : "92dvh",
          transition: "transform 0.25s ease, max-height 0.25s ease",
        }}
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
