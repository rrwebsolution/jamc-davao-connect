import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getBranding } from "@/lib/branding";

export const metadata: Metadata = { title: "Registration submitted" };

export default async function SubmittedPage() {
  const branding = await getBranding();
  return (
    <div className="text-center">
      <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-success/12 text-success">
        <MailCheck className="size-8" aria-hidden />
      </span>
      <h2 data-type="page-title" className="tracking-tight">Registration Submitted</h2>
      <p className="mt-3 text-sm text-muted-foreground">Thank you for creating your {branding.system_name} account.</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Your account is currently awaiting approval from a church administrator. You will be able to access{" "}
        {branding.system_name} once your account has been approved.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        If you were sent an email to confirm your address, please open the link in it as well.
      </p>
      <Link href="/login" className={`${buttonVariants()} mt-7 w-full`}>
        Back to Login
      </Link>
    </div>
  );
}