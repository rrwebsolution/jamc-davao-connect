import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { PersonProfilePage } from "@/components/people/person-pages";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Visitor profile" };

async function Content({ params }: Pick<PageProps<"/people/visitors/[id]">, "params">) {
  const { id } = await params;
  return <PersonProfilePage mode="visitor" id={id} />;
}

export default function Page({ params }: PageProps<"/people/visitors/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <Content params={params} />
    </PageBoundary>
  );
}