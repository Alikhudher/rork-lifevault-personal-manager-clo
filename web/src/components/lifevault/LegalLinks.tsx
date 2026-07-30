import React, { useState } from "react";
import { FormSheet } from "@/components/lifevault/FormSheet";

/**
 * Full-text legal documents shown inside the app in a bottom sheet.
 *
 * The Privacy Policy and Terms of Use (EULA) are Apple App Review
 * requirements (Guideline 3.1.2(c) for auto-renewable subscriptions).
 * These strings are the canonical copy — the same content as the hosted
 * `privacy.html` / `terms.html` pages, but rendered in-app so the user
 * never leaves the app to read them.
 */
export const PRIVACY_POLICY_SECTIONS: readonly { heading: string; body: string }[] = [
  {
    heading: "Information we may collect",
    body: "Account information such as your name and email address. Documents, images, expenses, subscriptions, reminders and appointments you choose to add. Technical information needed for security, troubleshooting and app performance. Support messages you send to us.",
  },
  {
    heading: "How information is used",
    body: "To provide account access, email verification and password recovery. To store, organise, back up and restore information you add. To provide AI-assisted document analysis when you use that feature. To improve security, reliability and support.",
  },
  {
    heading: "Data storage and security",
    body: "We use reasonable safeguards to protect information. Cloud backups are encrypted on your device before upload — we cannot read your encrypted data. No online service can guarantee absolute security.",
  },
  {
    heading: "Sharing of information",
    body: "We do not sell personal information. Information may be processed by service providers used for authentication, cloud storage, email delivery and AI processing only as needed to provide the service.",
  },
  {
    heading: "Your choices",
    body: "You may update or delete information in the app at any time. You may request account or data deletion by contacting us from the email associated with your account.",
  },
  {
    heading: "Children",
    body: "LifeVault is not specifically directed to children under 13.",
  },
  {
    heading: "Contact",
    body: "lifevaulthub.support@gmail.com",
  },
];

export const TERMS_OF_USE_SECTIONS: readonly { heading: string; body: string }[] = [
  {
    heading: "Acceptance of terms",
    body: "By downloading, installing, or using LifeVault, you agree to be bound by these Terms of Use (EULA). If you do not agree, do not use the app.",
  },
  {
    heading: "License",
    body: "LifeVault is licensed, not sold. You are granted a limited, non-exclusive, non-transferable license to use the app on your personal devices in accordance with these terms.",
  },
  {
    heading: "Subscriptions",
    body: "LifeVault Premium is an auto-renewable subscription. Payment is charged to your Apple App Store or Google Play account at confirmation of purchase. Subscriptions automatically renew unless auto-renew is turned off at least 24 hours before the end of the current billing period. Your account is charged for renewal within 24 hours before the end of the current period. You can manage and cancel your subscriptions anytime from your App Store or Google Play account settings.",
  },
  {
    heading: "Use of the app",
    body: "You agree to use LifeVault for personal, lawful purposes. You are responsible for the accuracy and legality of the documents and data you store. LifeVault provides reminders as a convenience and is not responsible for missed renewals or expired documents.",
  },
  {
    heading: "Data and backup",
    body: "You retain ownership of all data you add to LifeVault. Cloud backups are encrypted on your device before upload. You are responsible for keeping your account password secure, as it is used as the encryption key for your backups.",
  },
  {
    heading: "No warranty",
    body: 'The app is provided "as is" and "as available" without warranty of any kind. We do not guarantee that the app will be error-free, uninterrupted, or that your data will never be lost. Always verify important dates with the issuing authority.',
  },
  {
    heading: "Limitation of liability",
    body: "To the maximum extent permitted by law, LifeVault shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the app.",
  },
  {
    heading: "Changes to these terms",
    body: "We may update these terms from time to time. Continued use of the app after changes constitutes acceptance of the updated terms.",
  },
  {
    heading: "Contact",
    body: "lifevaulthub.support@gmail.com",
  },
];

export type LegalDocType = "privacy" | "terms";

/**
 * Renders the full Privacy Policy or Terms of Use inside a scrollable
 * bottom sheet. Used by the Settings page, Sign Up screen, and Premium
 * subscription screen so every legal entry point shows identical content.
 */
export function LegalSheet({
  doc,
  open,
  onOpenChange,
}: {
  doc: LegalDocType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isPrivacy = doc === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Use (EULA)";
  const sections = isPrivacy ? PRIVACY_POLICY_SECTIONS : TERMS_OF_USE_SECTIONS;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Last updated July 2026"
    >
      <div className="space-y-5 text-[13px] leading-relaxed text-muted-foreground">
        {isPrivacy ? (
          <p className="font-semibold text-foreground">
            LifeVault respects your privacy. This policy explains what information may be
            collected, why it is used, and the choices available to you.
          </p>
        ) : null}
        {sections.map((section) => (
          <div key={section.heading}>
            <h3 className="mb-1 text-[14px] font-bold text-foreground">{section.heading}</h3>
            <p>{section.body}</p>
          </div>
        ))}
        <p className="pt-2 text-center text-[11px]">
          © 2026 LifeVault. All rights reserved.
        </p>
      </div>
    </FormSheet>
  );
}

/**
 * Inline "Privacy Policy" and "Terms of Use" tappable links.
 *
 * Renders two text links separated by a middot. Tapping either opens the
 * full document in a `LegalSheet` bottom sheet. Used on the Premium screen
 * and Sign Up screen to satisfy Apple App Review Guideline 3.1.2(c).
 */
export function LegalLinks({
  className,
  onOpen,
}: {
  className?: string;
  onOpen: (doc: LegalDocType) => void;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onOpen("privacy")}
        className="font-bold text-primary underline-offset-2 hover:underline dark:text-foreground"
      >
        Privacy Policy
      </button>
      <span className="mx-1.5 text-muted-foreground/60">·</span>
      <button
        type="button"
        onClick={() => onOpen("terms")}
        className="font-bold text-primary underline-offset-2 hover:underline dark:text-foreground"
      >
        Terms of Use
      </button>
    </div>
  );
}

/**
 * Convenience hook: manages the `LegalSheet` open-state and returns the
 * sheet element + a `openLegal` callback. Drop the sheet into your JSX and
 * pass `openLegal` to `<LegalLinks onOpen={openLegal} />`.
 */
export function useLegalSheet() {
  const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null);
  const sheet = (
    <LegalSheet
      doc={legalDoc}
      open={legalDoc !== null}
      onOpenChange={(open) => !open && setLegalDoc(null)}
    />
  );
  return { legalDoc, setLegalDoc, openLegal: setLegalDoc, sheet };
}
