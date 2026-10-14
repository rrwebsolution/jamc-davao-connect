import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/auth-forms";
import { getBranding } from "@/lib/branding";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  const branding = await getBranding();
  return <SignUpForm systemName={branding.system_name} />;
}