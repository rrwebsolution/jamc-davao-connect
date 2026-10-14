"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccessWith } from "@/lib/auth/session";
import { isUuid } from "@/lib/data/common";
import { fail, friendlyError, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

// Giving collections (batch entry). The database functions do the real work
// and re-check finance.manage; these actions validate the shape and pass it on
// as the signed-in user.

const optionalId = z
  .union([z.literal(""), z.string().uuid()])
  .nullable()
  .optional()
  .transform((value) => value || null);

const entrySchema = z.object({
  category_id: z.string().uuid("Every entry needs a category"),
  payment_method_id: z.string().uuid("Every entry needs a payment method"),
  financial_account_id: optionalId,
  donor_person_id: optionalId,
  amount: z.coerce.number().positive("Amounts must be more than zero").max(99_999_999_999, "That amount is too large"),
  reference_number: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});

const collectionSchema = z.object({
  collection_name: z.string().trim().min(1, "Give the collection a name").max(160),
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the collection date"),
  // "" | "type:<attendance type id>" | "event:<event id>"
  service: z.string().max(60).optional().default(""),
  entry_mode: z.enum(["summary", "detailed"]),
  notes: z.string().trim().max(1000).optional().default(""),
  attachment_path: z.string().max(300).nullable().optional().transform((value) => value || ""),
  entries: z.array(entrySchema).max(500, "A collection can hold up to 500 entries"),
});

function parse(input: unknown) {
  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error } as const;
  const { service, entries, ...header } = parsed.data;
  const [kind, target] = service.split(":");
  return {
    header: {
      ...header,
      attendance_type_id: kind === "type" && isUuid(target) ? target : "",
      event_id: kind === "event" && isUuid(target) ? target : "",
    },
    entries,
  } as const;
}

async function save(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith("finance.manage");
  if (!access) return NOT_ALLOWED;
  const data = parse(input);
  if ("error" in data) return { ok: false, error: data.error ?? INVALID_INPUT.error };

  const supabase = await createClient();
  const { data: savedId, error } = await supabase.rpc("save_giving_collection", {
    target_id: id,
    header: data.header,
    entries: data.entries,
  });
  if (error || !savedId) return fail(error);
  return { ok: true, data: { id: savedId as string } };
}

/** Saves a draft: nothing reaches the ledger, reports or balances yet. */
export async function saveCollectionDraft(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await save(id, input);
  if (result.ok) refresh();
  return result;
}

/** Saves the collection as it is on screen, then posts it: each entry becomes a giving record. */
export async function postCollection(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const saved = await save(id, input);
  if (!saved.ok) return saved;

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_giving_collection", { target_id: saved.data!.id });
  if (error) {
    // The draft is saved; only the posting failed. Say so, with the id to go back to.
    refresh();
    return { ok: false, error: `Saved as a draft, but it could not be posted: ${friendlyError(error)}` };
  }
  refresh();
  return saved;
}

export async function voidCollection(id: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith("finance.manage");
  if (!access) return NOT_ALLOWED;
  const parsed = z.object({ reason: z.string().trim().min(1, "Give a reason for voiding").max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_giving_collection", { target_id: id, reason: parsed.data.reason });
  if (error) return fail(error);
  refresh();
  return { ok: true };
}

export async function discardCollection(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith("finance.manage");
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data: collection } = await supabase.from("giving_collections").select("attachment_path").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("discard_giving_collection", { target_id: id });
  if (error) return fail(error);
  // Best effort: a leftover file is harmless and private.
  if (collection?.attachment_path) await supabase.storage.from("payment-proofs").remove([collection.attachment_path]);
  refresh();
  return { ok: true };
}

export type ReferenceMatch = { reference_number: string; giving_date: string; payment_method_name: string | null; collection_name: string | null };

/** Reference numbers from this collection that are already in the ledger: possible duplicates. */
export async function findDuplicateReferences(id: string | null, references: unknown): Promise<ActionResult<{ matches: ReferenceMatch[] }>> {
  const parsed = z.array(z.string().trim().max(120)).max(500).safeParse(references);
  if (!parsed.success || (id !== null && !isUuid(id))) return INVALID_INPUT;
  const access = await getAccessWith("finance.view");
  if (!access) return NOT_ALLOWED;
  const refs = [...new Set(parsed.data.filter(Boolean))];
  if (refs.length === 0) return { ok: true, data: { matches: [] } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("existing_giving_references", { refs, exclude_collection: id });
  if (error) return fail(error);
  return { ok: true, data: { matches: (data ?? []) as ReferenceMatch[] } };
}
