import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { PersonProfilePage } from "@/components/people/person-pages";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Member profile" };

async function Content({ params, searchParams }: PageProps<"/people/members/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <PersonProfilePage mode="member" id={id} openAccountDialog={query.account === "new"} />;
}

export default function Page({ params, searchParams }: PageProps<"/people/members/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <Content params={params} searchParams={searchParams} />
    </PageBoundary>
  );
}