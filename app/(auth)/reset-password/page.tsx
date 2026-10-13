import type { Metadata } from "next";
import { AuthHeading, PasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading title="Choose a new password">It replaces your old one straight away.</AuthHeading>
      <PasswordForm redirectTo="/" />
    </>
  );
}