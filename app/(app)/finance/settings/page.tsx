import type { Metadata } from "next";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { moveLookup } from "@/app/(app)/admin/settings/actions";
import { saveFinancialAccount, savePaymentMethod, setAccountArchived } from "@/app/(app)/module-actions";
import { PageBoundary } from "@/components/app/page-boundary";
import { BackLink, ListEmpty, money, Panel } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FormValues } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import {
  ACCOUNT_TYPES,
  getFinancialAccounts,
  getPaymentMethods,
  METHOD_KINDS,
  type FinancialAccount,
  type PaymentMethod,
} from "@/lib/data/finance";
import { labelOf } from "@/lib/data/options";

export const metadata: Metadata = { title: "Finance settings" };

const METHOD_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true, wide: true, placeholder: "e.g. GCash" },
  {
    name: "kind",
    label: "Works like",
    type: "select",
    options: [...METHOD_KINDS],
    wide: true,
    hint: "Decides which accounts can be chosen with it and which extra fields the form asks for.",
  },
  { name: "requires_reference", label: "Reference number is required", type: "switch" },
  { name: "is_active", label: "Active", type: "switch", hint: "Inactive methods stay on old records but aren't offered for new ones." },
];

const ACCOUNT_FIELDS: FieldDef[] = [
  { name: "name", label: "Account name", type: "text", required: true, wide: true, placeholder: "e.g. JAMC GCash" },
  { name: "account_type", label: "Account type", type: "select", options: [...ACCOUNT_TYPES] },
  { name: "provider", label: "Provider / bank name", type: "text", placeholder: "GCash, Maya, or the bank", showWhen: { field: "account_type", in: ["e_wallet", "bank", "other"] } },
  { name: "account_holder", label: "Account holder", type: "text", showWhen: { field: "account_type", in: ["e_wallet", "bank", "other"] } },
  {
    name: "account_number",
    label: "Account number",
    type: "text",
    showWhen: { field: "account_type", in: ["e_wallet", "bank", "other"] },
    hint: "Shown in full only to finance managers. Everyone else sees it masked.",
  },
  { name: "opening_balance", label: "Opening balance (₱)", type: "number", hint: "What was in the account before records started here." },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "is_active", label: "Active", type: "switch" },
];

const methodValues = (method?: PaymentMethod): FormValues => ({
  name: method?.name ?? "",
  kind: method?.kind ?? "other",
  requires_reference: method?.requires_reference ?? false,
  is_active: method?.is_active ?? true,
});

const accountValues = (account?: FinancialAccount): FormValues => ({
  name: account?.name ?? "",
  account_type: account?.account_type ?? "e_wallet",
  provider: account?.provider ?? "",
  account_holder: account?.account_holder ?? "",
  account_number: account?.account_number ?? "",
  opening_balance: account ? String(account.opening_balance) : "0",
  notes: account?.notes ?? "",
  is_active: account?.is_active ?? true,
});

async function FinanceSettingsContent() {
  const access = await requireAccess();
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const canManage = can(access, "finance.manage");
  const [methods, accounts] = await Promise.all([
    getPaymentMethods({ includeInactive: true }),
    getFinancialAccounts({ includeArchived: true }),
  ]);

  return (
    <>
      <BackLink href="/finance">Back to finance</BackLink>
      <PageHeader title="Finance settings" description="How money is received and paid, and the accounts it sits in." />

      <div className="space-y-4">
        <Panel
          title="Payment methods"
          description="How giving is received and expenses are paid. Shown in this order on the forms."
          flush
          actions={
            canManage ? (
              <EntityDialog title="Add payment method" fields={METHOD_FIELDS} initial={methodValues()} action={savePaymentMethod.bind(null, null)} successMessage="Payment method added" size="sm">
                <Plus /> Add method
              </EntityDialog>
            ) : null
          }
        >
          {methods.length === 0 ? (
            <ListEmpty>No payment methods yet.</ListEmpty>
          ) : (
            <ul className="divide-y">
              {methods.map((method, index) => (
                <li key={method.id} className="flex flex-wrap items-center gap-2 p-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium">{method.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {labelOf(METHOD_KINDS, method.kind)}
                      {method.requires_reference ? " · reference required" : ""}
                    </p>
                  </div>
                  {method.is_active ? null : <StatusPill>Inactive</StatusPill>}
                  {canManage ? (
                    <div className="ml-auto flex items-center">
                      <ConfirmButtonless action={moveLookup.bind(null, "payment_methods", method.id, "up")} disabled={index === 0} label={`Move ${method.name} up`}>
                        <ArrowUp />
                      </ConfirmButtonless>
                      <ConfirmButtonless action={moveLookup.bind(null, "payment_methods", method.id, "down")} disabled={index === methods.length - 1} label={`Move ${method.name} down`}>
                        <ArrowDown />
                      </ConfirmButtonless>
                      <EntityDialog
                        title="Edit payment method"
                        fields={METHOD_FIELDS}
                        initial={methodValues(method)}
                        action={savePaymentMethod.bind(null, method.id)}
                        successMessage="Payment method updated"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${method.name}`}
                      >
                        <Pencil />
                      </EntityDialog>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Financial accounts"
          description="Where the church's money is received and kept. Balances are calculated from the records."
          flush
          actions={
            canManage ? (
              <EntityDialog title="Add account" fields={ACCOUNT_FIELDS} initial={accountValues()} action={saveFinancialAccount.bind(null, null)} successMessage="Account added" size="sm">
                <Plus /> Add account
              </EntityDialog>
            ) : null
          }
        >
          {accounts.length === 0 ? (
            <ListEmpty>No accounts yet.</ListEmpty>
          ) : (
            <ul className="divide-y">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-2 p-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium">{account.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        labelOf(ACCOUNT_TYPES, account.account_type),
                        account.provider,
                        account.account_holder,
                        // Full number for finance managers, masked for everyone else.
                        account.account_number ?? account.account_number_masked,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {Number(account.opening_balance) !== 0 ? (
                      <p className="text-xs text-muted-foreground">Opening balance {money(account.opening_balance)}</p>
                    ) : null}
                  </div>
                  {account.archived_at ? <StatusPill tone="danger">Archived</StatusPill> : account.is_active ? null : <StatusPill>Inactive</StatusPill>}
                  {canManage ? (
                    <div className="ml-auto flex items-center gap-1">
                      {account.archived_at ? null : (
                        <EntityDialog
                          title="Edit account"
                          fields={ACCOUNT_FIELDS}
                          initial={accountValues(account)}
                          action={saveFinancialAccount.bind(null, account.id)}
                          successMessage="Account updated"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${account.name}`}
                        >
                          <Pencil />
                        </EntityDialog>
                      )}
                      <ConfirmButton
                        action={setAccountArchived.bind(null, account.id, !account.archived_at)}
                        title={account.archived_at ? `Restore ${account.name}?` : `Archive ${account.name}?`}
                        description={
                          account.archived_at
                            ? "The account can be used for new records again."
                            : "It will no longer be offered on forms or shown in balances. Past records keep pointing to it."
                        }
                        confirmLabel={account.archived_at ? "Restore" : "Archive"}
                        successMessage={account.archived_at ? "Account restored" : "Account archived"}
                        destructive={!account.archived_at}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${account.archived_at ? "Restore" : "Archive"} ${account.name}`}
                      >
                        {account.archived_at ? <ArchiveRestore /> : <Archive />}
                      </ConfirmButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

/** An icon button that runs a Server Action straight away (reordering needs no confirmation). */
function ConfirmButtonless({
  action,
  disabled,
  label,
  children,
}: {
  action: () => Promise<unknown>;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await action();
      }}
    >
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        className="inline-flex size-7 items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
      >
        {children}
      </button>
    </form>
  );
}

export default function FinanceSettingsPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Finance settings" description="How money is received and paid, and the accounts it sits in." variant="detail" />}>
      <FinanceSettingsContent />
    </PageBoundary>
  );
}
