import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ChurchSettings, Lookup } from "@/lib/types";
import { describeError } from "@/lib/errors";

/** The sizes offered in Settings → General. The database accepts only these. */
export const PAGE_SIZES = [10, 20, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

export const DEFAULT_SETTINGS: ChurchSettings = {
  church_name: "JAMC-Davao",
  church_address: null,
  contact_number: null,
  email: null,
  timezone: "Asia/Manila",
  date_format: "MMM d, yyyy",
  member_id_prefix: "JAMC-",
  member_id_padding: 5,
  absence_threshold: 2,
  track_individual_giving: false,
  rows_per_page: DEFAULT_PAGE_SIZE,
};

export const getChurchSettings = cache(async (): Promise<ChurchSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("church_settings").select("*").maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
});

export type LookupTable =
  | "membership_statuses"
  | "baptism_statuses"
  | "attendance_types"
  | "attendance_statuses"
  | "discipleship_stages"
  | "ministries"
  | "giving_categories"
  | "expense_categories"
  | "payment_methods";

export async function getLookup(table: LookupTable, { includeInactive = false } = {}): Promise<Lookup[]> {
  const supabase = await createClient();
  let query = supabase.from(table).select("*").order("sort_order").order("name");
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  if (table === "ministries") {
    query = query.is("archived_at", null);
  }
  const { data, error } = await query;
  if (error) {
    console.error(`Failed to load ${table}`, describeError(error));
    return [];
  }
  return (data ?? []) as Lookup[];
}

/** Today's date in the church's timezone, as YYYY-MM-DD. */
export async function getChurchToday(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("church_today");
  return typeof data === "string" ? data : new Date().toISOString().slice(0, 10);
}

/**
 * Short-lived signed URLs for people photos. The bucket is private and its
 * policy only signs photos of people the caller is allowed to see.
 */
export async function signPhotoUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (unique.length === 0) {
    return {};
  }
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("people-photos").createSignedUrls(unique, 3600);
  if (error || !data) {
    return {};
  }
  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) {
      urls[item.path] = item.signedUrl;
    }
  }
  return urls;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Rows shown per page in every paginated list: the system-wide setting. */
export async function getPageSize(): Promise<number> {
  const { rows_per_page } = await getChurchSettings();
  return (PAGE_SIZES as readonly number[]).includes(rows_per_page) ? rows_per_page : DEFAULT_PAGE_SIZE;
}

/** The list parameters plus where the requested page starts, using the configured page size. */
export async function getListParams(raw: RawSearchParams) {
  const { params, page } = parseListParams(raw);
  const pageSize = await getPageSize();
  return { params, page, pageSize, from: (page - 1) * pageSize };
}

/** Flattens Next's searchParams and reads the page number. */
export function parseListParams(raw: RawSearchParams) {
  const params: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) {
      params[key] = single;
    }
  }
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return { params, page };
}

/** Removes characters that have meaning in a PostgREST filter expression. */
export function cleanSearchTerm(term: string | undefined) {
  return (term ?? "").replace(/[,()%*"\\]/g, " ").trim().slice(0, 80);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return Boolean(value && UUID.test(value));
}
