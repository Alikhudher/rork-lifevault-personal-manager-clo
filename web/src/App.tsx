import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/AppContext";
import { AppShell, PublicShell } from "@/components/lifevault/AppShell";

import Onboarding from "./pages/Onboarding";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Home from "./pages/Home";
import AIAssistant from "./pages/AIAssistant";
import Documents from "./pages/Documents";
import Expenses from "./pages/Expenses";
import Subscriptions from "./pages/Subscriptions";
import CalendarPage from "./pages/CalendarPage";
import Notifications from "./pages/Notifications";
import NotificationSettings from "./pages/NotificationSettings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user } = useApp();
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route element={<PublicShell />}>
      <Route
        path="/onboarding"
        element={
          <PublicOnly>
            <Onboarding />
          </PublicOnly>
        }
      />
      <Route
        path="/signin"
        element={
          <PublicOnly>
            <SignIn />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <SignUp />
          </PublicOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnly>
            <ForgotPassword />
          </PublicOnly>
        }
      />
    </Route>

    <Route element={<AppShell />}>
      <Route path="/" element={<Home />} />
      <Route path="/assistant" element={<AIAssistant />} />
      <Route path="/documents" element={<Documents />} />
      <Route path="/expenses" element={<Expenses />} />
      <Route path="/subscriptions" element={<Subscriptions />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/notifications/settings" element={<NotificationSettings />} />
      <Route path="/profile" element={<Profile />} />
    </Route>

    {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppProvider>
      <TooltipProvider>
        <Toaster position="top-center" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AppProvider>
  </QueryClientProvider>
);

export default App;
