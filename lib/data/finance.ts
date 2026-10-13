import "server-only";
import type { FieldDef, FieldOption } from "@/components/shared/entity-dialog";
import { createClient } from "@/lib/supabase/server";

export const METHOD_KINDS = [
  { value: "cash", label: "Cash" },
  { value: "e_wallet", label: "E-Wallet (GCash, Maya…)" },
  { value: "bank", label: "Bank transfer" },
  { value: "check", label: "Check" },
  { value: "other", label: "Other" },
] as const;

export const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "e_wallet", label: "E-Wallet" },
  { value: "bank", label: "Bank Account" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethod = {
  id: string;
  name: string;
  kind: "cash" | "e_wallet" | "bank" | "check" | "other";
  requires_reference: boolean;
  is_active: boolean;
  sort_order: number;
};

/** A row of `financial_account_directory`. `account_number` is null unless the viewer manages finance. */
export type FinancialAccount = {
  id: string;
  name: string;
  account_type: "cash" | "e_wallet" | "bank" | "other";
  provider: string | null;
  account_holder: string | null;
  account_number: string | null;
  account_number_masked: string | null;
  opening_balance: number;
  notes: string | null;
  is_active: boolean;
  archived_at: string | null;
};

export async function getPaymentMethods({ includeInactive = false } = {}): Promise<PaymentMethod[]> {
  const supabase = await createClient();
  let query = supabase.from("payment_methods").select("*").order("sort_order").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []) as PaymentMethod[];
}

export async function getFinancialAccounts({ includeArchived = false } = {}): Promise<FinancialAccount[]> {
  const supabase = await createClient();
  let query = supabase.from("financial_account_directory").select("*").order("sort_order").order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data } = await query;
  return (data ?? []) as FinancialAccount[];
}

const accountLabel = (account: FinancialAccount) =>
  account.account_number_masked ? `${account.name} · ${account.account_number_masked}` : account.name;

/**
 * The "how" and "where" fields shared by the giving and expense forms. The
 * account list follows the chosen method (GCash shows e-wallet accounts, Cash
 * shows cash accounts, ...) and the reference number becomes required for
 * methods configured that way.
 */
export function paymentFields(
  methods: PaymentMethod[],
  accounts: FinancialAccount[],
  accountLabelText: string,
): { fields: FieldDef[]; checkMethodIds: string[]; nonCheckMethodIds: string[] } {
  const usable = accounts.filter((account) => account.is_active);
  const byType = (types: string[] | null) =>
    usable.filter((account) => !types || types.includes(account.account_type)).map((account) => ({ value: account.id, label: accountLabel(account) }));
  const forKind: Record<string, string[] | null> = { cash: ["cash"], e_wallet: ["e_wallet"], bank: ["bank"], check: null, other: null };

  const map: Record<string, FieldOption[]> = {};
  for (const method of methods) {
    map[method.id] = byType(forKind[method.kind]);
  }
  const checkMethodIds = methods.filter((method) => method.kind === "check").map((method) => method.id);
  const nonCheckMethodIds = methods.filter((method) => method.kind !== "check").map((method) => method.id);

  return {
    checkMethodIds,
    nonCheckMethodIds,
    fields: [
      {
        name: "payment_method_id",
        label: "Payment method",
        type: "select",
        options: methods.map((method) => ({ value: method.id, label: method.name })),
        emptyLabel: "Choose how it was paid…",
        required: true,
      },
      {
        name: "financial_account_id",
        label: accountLabelText,
        type: "select",
        optionsBy: { field: "payment_method_id", map },
        emptyLabel: "Choose an account…",
        required: true,
        hint: "Only accounts that match the payment method are listed. Add accounts under Finance → Settings.",
      },
      {
        name: "reference_number",
        label: "Reference number",
        type: "text",
        showWhen: { field: "payment_method_id", in: ["", ...nonCheckMethodIds] },
        requiredWhen: { field: "payment_method_id", in: methods.filter((method) => method.requires_reference).map((method) => method.id) },
      },
    ],
  };
}
