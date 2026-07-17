import { NavLink } from "react-router-dom";
import { CalendarDays, FileText, House, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: House },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40">
      <div className="mx-auto w-full max-w-md border-t border-border bg-card/90 backdrop-blur-xl pb-safe">
        <div className="grid grid-cols-5">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/"}
              className={({ isActive }) =>
                cn(
                  "group flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "flex h-7 w-12 items-center justify-center rounded-full transition-all duration-300",
                      isActive ? "bg-primary/10" : "bg-transparent group-active:scale-90",
                    )}
                  >
                    <tab.icon className="h-[19px] w-[19px]" strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {tab.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
