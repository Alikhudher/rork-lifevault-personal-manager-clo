import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { BottomNav } from "./BottomNav";
import { AppLock } from "./AppLock";

/**
 * Listens for native app lifecycle events and notifies the AppContext so it
 * can auto-lock based on the user's Security settings. On web (no native
 * runtime) it falls back to the Page Visibility API.
 */
function useAutoLockLifecycle() {
  const { noteBackgrounded, noteForegrounded } = useApp();

  useEffect(() => {
    let active = true;

    if (Capacitor.isNativePlatform()) {
      const resume = App.addListener("appStateChange", (state) => {
        if (!active) return;
        if (state.isActive) {
          noteForegrounded();
        } else {
          noteBackgrounded();
        }
      });
      const pause = App.addListener("pause", () => {
        if (active) noteBackgrounded();
      });
      const resumeResume = App.addListener("resume", () => {
        if (active) noteForegrounded();
      });
      return () => {
        active = false;
        void resume.then((h) => h.remove());
        void pause.then((h) => h.remove());
        void resumeResume.then((h) => h.remove());
      };
    }

    // Web fallback — Page Visibility API.
    const onVisibility = () => {
      if (document.hidden) {
        noteBackgrounded();
      } else {
        noteForegrounded();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [noteBackgrounded, noteForegrounded]);
}

/** Layout for authenticated tab screens: centered mobile frame + bottom navigation. */
export function AppShell() {
  const { user, onboarded } = useApp();
  const location = useLocation();
  const scrollRef = useKeyboardAvoidance();

  useAutoLockLifecycle();

  if (!onboarded) return <Navigate to="/onboarding" replace />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-background shadow-2xl shadow-primary/5">
      <main ref={scrollRef} className="pb-28">
        <Outlet />
      </main>
      <BottomNav />
      <AppLock />
    </div>
  );
}

/** Layout for public screens (onboarding / auth) — no bottom nav. */
export function PublicShell() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-background shadow-2xl shadow-primary/5">
      <Outlet />
    </div>
  );
}
