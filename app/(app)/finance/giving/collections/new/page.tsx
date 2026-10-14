import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { CollectionEditor } from "@/components/finance/collection-editor";
import { BackLink } from "@/components/shared/blocks";
import { NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getCollectionOptions } from "@/lib/data/collections";

export const metadata: Metadata = { title: "New giving collection" };

const DESCRIPTION = "Enter a whole service's giving on one page. Save it as a draft, or review and post it.";

async function Content() {
  const access = await requireAccess();
  if (!can(access, "finance.manage")) {
    return <NoAccess />;
  }
  const options = await getCollectionOptions();

  return (
    <>
      <BackLink href="/finance/giving/collections">Back to collections</BackLink>
      <PageHeader title="New giving collection" description={DESCRIPTION} />
      <CollectionEditor
        initial={null}
        today={options.today}
        categories={options.categories}
        methods={options.methods}
        accounts={options.accounts}
        services={options.services}
        defaultService={options.defaultService ? `type:${options.defaultService.id}` : ""}
        donors={options.donors}
      />
    </>
  );
}

export default function Page() {
  return (
    <PageBoundary fallback={<PageSkeleton title="New giving collection" description={DESCRIPTION} variant="form" />}>
      <Content />
    </PageBoundary>
  );
}
