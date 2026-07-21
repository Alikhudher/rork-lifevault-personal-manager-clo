import React from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { DeliveryUpdate } from "@/lib/email-delivery";
import { cn } from "@/lib/utils";

/**
 * Inline, truthful email-delivery status shown under the code input.
 *
 * Driven by `trackEmailDelivery`'s onUpdate stream (which reads Brevo's
 * own logs), so it never claims more than the mail service confirmed:
 *  - "delivered" appears ONLY on Brevo's delivery receipt,
 *  - Gmail throttling shows "accepted and may be delayed",
 *  - hard failures show the provider's real reason.
 */
export function DeliveryStatusLine({ state }: { state: DeliveryUpdate | null }) {
  if (!state) return null;

  let icon: React.ReactNode;
  let text: string;
  let tone: string;

  if (state.status === "delivered") {
    icon = <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
    text = "Email delivered — check Spam if you don't see it.";
    tone = "text-success";
  } else if (state.status === "failed") {
    icon = <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
    text = state.reason
      ? `Couldn't deliver the email: ${state.reason.slice(0, 140)}`
      : "The mail service reported a delivery failure. Check the address and resend.";
    tone = "text-destructive";
  } else if (state.status === "delayed") {
    icon = <Clock className="h-3.5 w-3.5 shrink-0" />;
    text = "Email accepted and may be delayed — your inbox is throttling it. Check Spam too.";
    tone = "text-warning";
  } else if (state.final) {
    icon = <Clock className="h-3.5 w-3.5 shrink-0" />;
    text = "Email accepted — delivery not confirmed yet. Give it a minute and check Spam.";
    tone = "text-muted-foreground";
  } else {
    icon = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />;
    text = "Email accepted — confirming delivery…";
    tone = "text-muted-foreground";
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start justify-center gap-1.5 text-center text-[12px] font-semibold leading-relaxed",
        tone,
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span>{text}</span>
    </p>
  );
}
