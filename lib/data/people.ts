import "server-only";
import { cleanSearchTerm, isUuid, PAGE_SIZE } from "@/lib/data/common";
import { createClient } from "@/lib/supabase/server";
import type { Person, PersonType } from "@/lib/types";
import { describeError } from "@/lib/errors";

const MEMBER_SORTS = ["full_name", "member_code", "membership_date", "cell_group_name", "created_at"];
const VISITOR_SORTS = ["full_name", "first_visit_date", "visitor_status", "created_at"];

export async function listPeople(
  type: PersonType,
  params: Record<string, string | undefined>,
  from: number,
) {
  const supabase = await createClient();
  let query = supabase.from("people_directory").select("*", { count: "exact" }).eq("person_type", type);

  // "status" covers the Active / Inactive / Archived filter.
  if (params.status === "archived") {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
    if (params.status === "active") query = query.eq("is_active", true);
    if (params.status === "inactive") query = query.eq("is_active", false);
  }

  const term = cleanSearchTerm(params.q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      `full_name.ilike.${pattern},member_code.ilike.${pattern},contact_number.ilike.${pattern},email.ilike.${pattern}`,
    );
  }

  if (params.gender === "male" || params.gender === "female") query = query.eq("gender", params.gender);
  if (isUuid(params.group)) query = query.eq("cell_group_id", params.group);
  if (isUuid(params.ministry)) query = query.contains("ministry_ids", [params.ministry]);
  if (isUuid(params.membership)) query = query.eq("membership_status_id", params.membership);
  if (isUuid(params.stage)) query = query.eq("discipleship_stage_id", params.stage);
  if (type === "visitor" && params.vstatus) query = query.eq("visitor_status", params.vstatus);

  const allowed = type === "member" ? MEMBER_SORTS : VISITOR_SORTS;
  const fallback = type === "member" ? "full_name" : "first_visit_date";
  const sort = params.sort && allowed.includes(params.sort) ? params.sort : fallback;
  const ascending = params.sort ? params.dir !== "desc" : type === "member";

  const { data, count, error } = await query
    .order(sort, { ascending, nullsFirst: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("Failed to list people", describeError(error));
  }
  return { rows: (data ?? []) as Person[], total: count ?? 0, failed: Boolean(error) };
}

export async function getPerson(id: string, type?: PersonType): Promise<Person | null> {
  if (!isUuid(id)) {
    return null;
  }
  const supabase = await createClient();
  let query = supabase.from("people_directory").select("*").eq("id", id);
  if (type) {
    query = query.eq("person_type", type);
  }
  const { data } = await query.maybeSingle();
  return (data as Person | null) ?? null;
}

export type Option = { id: string; name: string };

/** Active members, for "mentor" and "link to a person" pickers. */
export async function getMemberOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("people")
    .select("id, full_name")
    .eq("person_type", "member")
    .is("archived_at", null)
    .order("full_name")
    .limit(1000);
  return (data ?? []).map((row) => ({ id: row.id, name: row.full_name }));
}

export async function getCellGroupOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cell_groups")
    .select("id, name")
    .is("archived_at", null)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Option[];
}
