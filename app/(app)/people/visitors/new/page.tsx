import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { PersonFormPage } from "@/components/people/person-pages";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Register visitor" };

export default function Page() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Register visitor" variant="form" />}>
      <PersonFormPage mode="visitor" />
    </PageBoundary>
  );
}