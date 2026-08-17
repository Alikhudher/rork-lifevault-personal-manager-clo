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
  const { user, onboarded, authReady } = useApp();
  const location = useLocation();
  const scrollRef = useKeyboardAvoidance();

  useAutoLockLifecycle();

  if (!onboarded) return <Navigate to="/onboarding" replace />;
  // Wait for the initial Supabase session check to complete before
  // deciding to redirect. Without this, a page reload with a valid
  // session would flash the sign-in page before getSession() returns.
  if (!authReady) return null;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md md:max-w-none md:px-8 bg-background shadow-2xl shadow-primary/5">
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
  const { authReady } = useApp();
  // Auth screens also wait for authReady so that a reload with a valid
  // session doesn't briefly show the sign-in page before the session
  // restore completes and redirects to the app.
  if (!authReady) return null;
  // Auth screen scroll avoidance
  const scrollRef = useKeyboardAvoidance<HTMLDivElement>();
  return (
    <div
      ref={scrollRef}
      className="mx-auto min-h-dvh w-full max-w-md md:max-w-none md:px-8 bg-background shadow-2xl shadow-primary/5"
    >
      <Outlet />
    </div>
  );
}
