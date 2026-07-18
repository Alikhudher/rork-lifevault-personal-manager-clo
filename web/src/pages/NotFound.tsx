import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-[hsl(219,60%,14%)] via-[hsl(218,57%,19%)] to-[hsl(216,52%,26%)] px-8 pt-safe text-center text-white">
      <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-white/5 blur-2xl" aria-hidden />
      <div className="absolute -bottom-32 -right-16 h-72 w-72 rounded-full bg-info/20 blur-3xl" aria-hidden />

      <div className="relative flex flex-col items-center">
        <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
          <Compass className="h-10 w-10 text-white" strokeWidth={1.6} />
        </span>
        <p className="text-[64px] font-extrabold leading-none tracking-tight tabular">404</p>
        <h1 className="mt-3 text-[20px] font-extrabold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-[280px] text-pretty text-[14px] leading-relaxed text-white/65">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Button asChild size="lg" className="mt-8 h-[52px] rounded-2xl px-8 text-[15px] font-bold shadow-lg shadow-primary/25">
          <Link to="/">
            <Home className="h-5 w-5" /> Back to Home
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
