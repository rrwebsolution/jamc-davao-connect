import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ban, Hourglass, ShieldOff } from "lucide-react";
import { signOutToLogin } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccountState } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account status" };

const SCREENS = {
  pending: {
    icon: Hourglass,
    tone: "bg-warning/15 text-warning",
    title: "Account Pending Approval",
    lines: [
      "Your account has been successfully created and is currently awaiting approval from a church administrator.",
      "Please check again later.",
    ],
  },
  rejected: {
    icon: Ban,
    tone: "bg-destructive/10 text-destructive",
    title: "Registration Not Approved",
    lines: [
      "Your account registration was not approved.",
      "Please contact the church administrator if you believe this is an error.",
    ],
  },
  suspended: {
    icon: ShieldOff,
    tone: "bg-muted text-muted-foreground",
    title: "Account Not Active",
    lines: ["This account has been deactivated.", "Please contact the church administrator."],
  },
} as const;

async function Status() {
  const { state, email } = await getAccountState();
  if (state === "signed_out") redirect("/login");
  if (state === "active") redirect("/");

  // Only the status is shown. Internal notes about a decision never reach this page.
  const screen = SCREENS[state];
  return (
    <div className="text-center">
      <span className={`mx-auto mb-5 flex size-16 items-center justify-center rounded-full ${screen.tone}`}>
        <screen.icon className="size-8" aria-hidden />
      </span>
      <h2 data-type="page-title" className="tracking-tight">{screen.title}</h2>
      {screen.lines.map((line) => (
        <p key={line} className="mt-3 text-sm text-muted-foreground">
          {line}
        </p>
      ))}
      {email ? <p className="mt-4 text-xs text-muted-foreground">Signed in as {email}</p> : null}
      <form action={signOutToLogin} className="mt-7">
        <Button type="submit" variant="outline" className="w-full">
          Sign Out
        </Button>
      </form>
    </div>
  );
}

export default function PendingApprovalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
      <Status />
    </Suspense>
  );
}