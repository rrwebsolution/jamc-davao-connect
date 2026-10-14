import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ban, Paperclip, Trash2 } from "lucide-react";
import { discardCollection, voidCollection } from "@/app/(app)/finance/collection-actions";
import { PageBoundary } from "@/components/app/page-boundary";
import { CollectionEditor } from "@/components/finance/collection-editor";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackLink, Detail, money, Panel } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getCollection, getCollectionOptions, type CollectionEntry } from "@/lib/data/collections";
import { getChurchSettings, isUuid } from "@/lib/data/common";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Giving collection" };

const TONE = { draft: "warning", posted: "success", voided: "danger" } as const;
const LABEL = { draft: "Draft", posted: "Posted", voided: "Voided" } as const;

/** Totals of the entries by one of their names, largest first. */
function breakdown(entries: CollectionEntry[], key: "payment_method_name" | "category_name") {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry[key], (totals.get(entry[key]) ?? 0) + entry.amount);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

async function Content({ params }: Pick<PageProps<"/finance/giving/collections/[id]">, "params">) {
  const access = await requireAccess();
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { collection, entries } = await getCollection(id);
  if (!collection) notFound();
  const canManage = can(access, "finance.manage");

  // A draft is still being entered: show the entry screen.
  if (collection.status === "draft" && canManage) {
    const options = await getCollectionOptions();
    return (
      <>
        <BackLink href="/finance/giving/collections">Back to collections</BackLink>
        <PageHeader
          title={collection.collection_name}
          description="Draft: not in the reports or account balances until it is posted."
          actions={
            <ConfirmButton
              action={discardCollection.bind(null, collection.id)}
              title="Discard this draft?"
              description="The draft and its entries are removed. Nothing was posted, so no totals change. This can't be undone."
              confirmLabel="Discard draft"
              successMessage="Draft discarded"
              redirectTo="/finance/giving/collections"
              destructive
              variant="outline"
            >
              <Trash2 /> Discard draft
            </ConfirmButton>
          }
        />
        <CollectionEditor
          // A saved draft comes back from the server: start the form again from it.
          key={`${collection.id}-${entries.length}-${collection.total}`}
          initial={{
            id: collection.id,
            collection_name: collection.collection_name,
            collection_date: collection.collection_date,
            service: collection.event_id ? `event:${collection.event_id}` : collection.attendance_type_id ? `type:${collection.attendance_type_id}` : "",
            entry_mode: collection.entry_mode,
            notes: collection.notes ?? "",
            attachment_path: collection.attachment_path,
            entries: entries.map((entry) => ({
              category_id: entry.category_id,
              payment_method_id: entry.payment_method_id,
              financial_account_id: entry.financial_account_id,
              donor_person_id: entry.donor_person_id,
              amount: entry.amount,
              reference_number: entry.reference_number,
              notes: entry.notes,
            })),
          }}
          today={options.today}
          categories={options.categories}
          methods={options.methods}
          accounts={options.accounts}
          services={options.services}
          defaultService=""
          donors={options.donors}
        />
      </>
    );
  }

  const settings = await getChurchSettings();
  // The attachment is private: a short-lived link, made only for someone who may see finance.
  let attachmentUrl: string | null = null;
  if (collection.attachment_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(collection.attachment_path, 300);
    attachmentUrl = data?.signedUrl ?? null;
  }
  const hasDonors = entries.some((entry) => entry.donor_name);
  const hasReferences = entries.some((entry) => entry.reference_number);

  return (
    <>
      <BackLink href="/finance/giving/collections">Back to collections</BackLink>
      <PageHeader
        title={collection.collection_name}
        description={[formatDate(collection.collection_date, settings.date_format), collection.event_name ?? collection.attendance_type_name].filter(Boolean).join(" · ")}
        actions={
          <>
            {attachmentUrl ? (
              <a href={attachmentUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                <Paperclip /> Attachment
              </a>
            ) : null}
            {collection.status === "posted" && canManage ? (
              <EntityDialog
                title="Void this collection?"
                description={`${money(collection.total)} in ${collection.entry_count} entries will be taken out of the Finance reports and account balances. The collection and its entries are kept as history. This can't be undone.`}
                fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, placeholder: "e.g. Entered twice." }]}
                initial={{ reason: "" }}
                action={voidCollection.bind(null, collection.id)}
                submitLabel="Void collection"
                successMessage="Collection voided"
                variant="outline"
              >
                <Ban /> Void collection
              </EntityDialog>
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total collection</p>
              <p className={`mt-1 text-3xl font-semibold tabular-nums ${collection.status === "voided" ? "text-muted-foreground line-through" : ""}`}>{money(collection.total)}</p>
            </div>
            <StatusPill tone={TONE[collection.status]}>{LABEL[collection.status]}</StatusPill>
          </div>
          {collection.status === "voided" ? (
            <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm">
              Voided{collection.voided_at ? ` on ${formatDateTime(collection.voided_at, settings.timezone)}` : ""}
              {collection.voided_by_name ? ` by ${collection.voided_by_name}` : ""}. These amounts are not counted in any report or balance.
              {collection.void_reason ? ` Reason: ${collection.void_reason}` : ""}
            </p>
          ) : null}
          <dl className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Entries">{String(collection.entry_count)}</Detail>
            <Detail label="Entry mode">{collection.entry_mode === "summary" ? "Summary" : "Detailed / individual"}</Detail>
            <Detail label="Recorded by">{collection.created_by_name}</Detail>
            <Detail label="Posted">
              {collection.posted_at ? `${formatDateTime(collection.posted_at, settings.timezone)}${collection.posted_by_name ? ` by ${collection.posted_by_name}` : ""}` : null}
            </Detail>
            {collection.notes ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <Detail label="Notes">{collection.notes}</Detail>
              </div>
            ) : null}
          </dl>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {(
            [
              ["Payment breakdown", breakdown(entries, "payment_method_name")],
              ["Category breakdown", breakdown(entries, "category_name")],
            ] as const
          ).map(([title, items]) => (
            <Panel key={title} title={title}>
              <ul className="space-y-2 text-sm">
                {items.map(([label, amount]) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{label}</span>
                    <span className="font-medium tabular-nums">{money(amount)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>

        <Panel title="Entries" description="Each line is one giving record. The total above is their sum, never an amount of its own." flush>
          <ul className="scroll-list divide-y md:hidden">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.category_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[entry.payment_method_name, entry.account_name, entry.donor_name, entry.reference_number].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{money(entry.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Account</TableHead>
                  {hasDonors ? <TableHead>Donor</TableHead> : null}
                  {hasReferences ? <TableHead>Reference</TableHead> : null}
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.category_name}</TableCell>
                    <TableCell>{entry.payment_method_name}</TableCell>
                    <TableCell>{entry.account_name ?? "—"}</TableCell>
                    {hasDonors ? <TableCell>{entry.donor_name ?? "Anonymous"}</TableCell> : null}
                    {hasReferences ? <TableCell>{entry.reference_number ?? "—"}</TableCell> : null}
                    <TableCell className="text-right font-medium tabular-nums">{money(entry.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/finance/giving/collections/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <Content params={params} />
    </PageBoundary>
  );
}
