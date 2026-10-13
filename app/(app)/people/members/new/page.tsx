import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { PersonFormPage } from "@/components/people/person-pages";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Add member" };

export default function Page() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Add member" variant="form" />}>
      <PersonFormPage mode="member" />
    </PageBoundary>
  );
}