import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, ChartPie, FileLock2, ShieldCheck, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    icon: FileLock2,
    accent: ShieldCheck,
    title: "Store important documents",
    body: "Keep passports, licences, insurance and warranties safely organised — with every expiry date in one vault.",
  },
  {
    icon: BellRing,
    accent: Vault,
    title: "Never miss a renewal",
    body: "Get reminders before documents expire, subscriptions renew and bills fall due — days or weeks ahead.",
  },
  {
    icon: ChartPie,
    accent: Vault,
    title: "Track every dollar",
    body: "See daily and monthly spending by category, and stay on top of your budget without a spreadsheet.",
  },
];

export default function Onboarding() {
  const [index, setIndex] = useState<number>(0);
  const navigate = useNavigate();
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const Icon = slide.icon;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Hero */}
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[hsl(219,60%,14%)] via-[hsl(218,57%,19%)] to-[hsl(216,52%,26%)] px-8 pt-safe text-center">
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-white/5 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -right-16 h-72 w-72 rounded-full bg-info/20 blur-3xl" aria-hidden />

        <div className="mb-8 flex items-center gap-2 text-white/80">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
            <Vault className="h-[18px] w-[18px]" />
          </span>
          <span className="text-sm font-bold tracking-[0.18em]">LIFEVAULT</span>
        </div>

        <div key={index} className="animate-fade-up">
          <div className="mx-auto mb-10 flex h-36 w-36 items-center justify-center rounded-[2.5rem] bg-white/10 ring-1 ring-white/15 backdrop-blur">
            <Icon className="h-16 w-16 text-white" strokeWidth={1.6} />
          </div>
          <h1 className="text-balance text-[26px] font-extrabold leading-tight tracking-tight text-white">
            {slide.title}
          </h1>
          <p className="mx-auto mt-3 max-w-[300px] text-pretty text-[15px] leading-relaxed text-white/70">
            {slide.body}
          </p>
        </div>

        <div className="mt-10 flex items-center gap-2" role="tablist" aria-label="Onboarding progress">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                i === index ? "w-7 bg-white" : "w-2 bg-white/30",
              )}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3 px-6 pt-8" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2.5rem)" }}>
        <Button
          size="lg"
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          onClick={() => (isLast ? navigate("/signup") : setIndex(index + 1))}
        >
          {isLast ? "Get Started" : "Continue"}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold text-primary dark:text-foreground"
          onClick={() => navigate("/signin")}
        >
          Sign In
        </Button>
      </div>
    </div>
  );
}
