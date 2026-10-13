import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { PersonFormPage } from "@/components/people/person-pages";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Edit member" };

async function Content({ params }: Pick<PageProps<"/people/members/[id]/edit">, "params">) {
  const { id } = await params;
  return <PersonFormPage mode="member" id={id} />;
}

export default function Page({ params }: PageProps<"/people/members/[id]/edit">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="form" />}>
      <Content params={params} />
    </PageBoundary>
  );
}