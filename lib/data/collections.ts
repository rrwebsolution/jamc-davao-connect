import "server-only";
import { getChurchSettings, getChurchToday, getLookup } from "@/lib/data/common";
import { getFinancialAccounts, getPaymentMethods } from "@/lib/data/finance";
import { getCategoryOptions } from "@/lib/data/options";
import { createClient } from "@/lib/supabase/server";

/** A row of `giving_collection_summary`: the header plus totals worked out from its lines. */
export type CollectionSummary = {
  id: string;
  collection_name: string;
  collection_date: string;
  attendance_type_id: string | null;
  attendance_type_name: string | null;
  event_id: string | null;
  event_name: string | null;
  entry_mode: "summary" | "detailed";
  status: "draft" | "posted" | "voided";
  notes: string | null;
  attachment_path: string | null;
  created_by_name: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  voided_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  entry_count: number;
  total: number;
};

/** A row of `giving_collection_entry_details`. */
export type CollectionEntry = {
  id: string;
  position: number;
  category_id: string;
  category_name: string;
  payment_method_id: string;
  payment_method_name: string;
  financial_account_id: string | null;
  account_name: string | null;
  donor_person_id: string | null;
  donor_name: string | null;
  amount: number;
  reference_number: string | null;
  notes: string | null;
};

export type EditorOption = { value: string; label: string };
export type EditorMethod = { id: string; name: string; kind: string; requires_reference: boolean };
export type EditorAccount = { id: string; label: string; account_type: string };

export async function getCollection(id: string) {
  const supabase = await createClient();
  const [summary, entries] = await Promise.all([
    supabase.from("giving_collection_summary").select("*").eq("id", id).maybeSingle(),
    supabase.from("giving_collection_entry_details").select("*").eq("collection_id", id).order("position"),
  ]);
  return {
    collection: (summary.data as CollectionSummary | null) ?? null,
    entries: ((entries.data ?? []) as CollectionEntry[]).map((entry) => ({ ...entry, amount: Number(entry.amount) })),
  };
}

/** Everything the entry screen chooses from. Lists come from Finance settings, never from code. */
export async function getCollectionOptions() {
  const supabase = await createClient();
  const [categories, methods, accounts, types, events, settings, today] = await Promise.all([
    getCategoryOptions("giving_categories"),
    getPaymentMethods(),
    getFinancialAccounts(),
    getLookup("attendance_types"),
    supabase.from("events").select("id, name, event_date").is("archived_at", null).order("event_date", { ascending: false }).limit(40),
    getChurchSettings(),
    getChurchToday(),
  ]);

  // Donors only when the church tracks individual giving.
  let donors: EditorOption[] | null = null;
  if (settings.track_individual_giving) {
    const { data } = await supabase
      .from("people")
      .select("id, full_name, member_code")
      .eq("person_type", "member")
      .is("archived_at", null)
      .order("full_name")
      .limit(3000);
    // The code keeps two members with the same name apart.
    donors = (data ?? []).map((row) => ({ value: row.id, label: row.member_code ? `${row.full_name} (${row.member_code})` : row.full_name }));
  }

  return {
    today,
    dateFormat: settings.date_format,
    categories: categories as EditorOption[],
    methods: methods.map((method) => ({ id: method.id, name: method.name, kind: method.kind, requires_reference: method.requires_reference })) as EditorMethod[],
    accounts: accounts
      .filter((account) => account.is_active)
      .map((account) => ({
        id: account.id,
        label: account.account_number_masked ? `${account.name} · ${account.account_number_masked}` : account.name,
        account_type: account.account_type,
      })) as EditorAccount[],
    services: [
      ...types.map((type) => ({ value: `type:${type.id}`, label: type.name })),
      ...(events.data ?? []).map((event) => ({ value: `event:${event.id}`, label: `${event.name} (event)` })),
    ] as EditorOption[],
    defaultService: types.find((type) => type.is_default) ?? types.find((type) => /sunday/i.test(type.name)) ?? null,
    donors,
  };
}
