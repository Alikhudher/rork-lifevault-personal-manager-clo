import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { BottomNav } from "./BottomNav";

/** Layout for authenticated tab screens: centered mobile frame + bottom navigation. */
export function AppShell() {
  const { user, onboarded } = useApp();
  const location = useLocation();
  const scrollRef = useKeyboardAvoidance();

  if (!onboarded) return <Navigate to="/onboarding" replace />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-background shadow-2xl shadow-primary/5">
      <main ref={scrollRef} className="pb-28">
        <Outlet />
      </main>
      <BottomNav />
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
