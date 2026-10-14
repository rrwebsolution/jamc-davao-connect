"use server";

import { refresh } from "next/cache";
import { P } from "@/lib/auth/permissions";
import { getAccessWith } from "@/lib/auth/session";
import { getChurchToday, isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { memberSchema, ownContactSchema, visitorSchema } from "@/lib/validation";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Removes a replaced photo. Best effort: a leftover file is harmless. */
async function removeOldPhoto(supabase: Supabase, previous: string | null | undefined, current: string | null) {
  if (previous && previous !== current) {
    await supabase.storage.from("people-photos").remove([previous]);
  }
}

/** Moves a person to a cell group, closing their previous membership as history. */
async function syncCellGroup(supabase: Supabase, personId: string, groupId: string | null) {
  const { data: current } = await supabase
    .from("cell_group_members")
    .select("id, cell_group_id")
    .eq("person_id", personId)
    .is("left_at", null)
    .maybeSingle();

  if ((current?.cell_group_id ?? null) === groupId) {
    return null;
  }
  const today = await getChurchToday();
  if (current) {
    const { error } = await supabase.from("cell_group_members").update({ left_at: today }).eq("id", current.id);
    if (error) return error;
  }
  if (groupId) {
    const { error } = await supabase
      .from("cell_group_members")
      .insert({ cell_group_id: groupId, person_id: personId, joined_at: today });
    if (error) return error;
  }
  return null;
}

export async function saveMember(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(id ? P.membersUpdate : P.membersCreate);
  if (!access) return NOT_ALLOWED;

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  // Ministries are assigned on the Ministries page (a member can serve in several).
  const { cell_group_id, ministry_id, ...person } = parsed.data;
  void ministry_id;

  const supabase = await createClient();
  let personId = id;

  if (id) {
    const { data: before } = await supabase.from("people").select("photo_path").eq("id", id).maybeSingle();
    const { data, error } = await supabase
      .from("people")
      .update(person)
      .eq("id", id)
      .eq("person_type", "member")
      .select("id")
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return fail("That member could not be found, or you don't have access to edit them.");
    await removeOldPhoto(supabase, before?.photo_path, person.photo_path);
  } else {
    const { data, error } = await supabase
      .from("people")
      .insert({ ...person, person_type: "member" })
      .select("id")
      .single();
    if (error) return fail(error);
    personId = data.id;
  }

  const groupError = await syncCellGroup(supabase, personId!, cell_group_id);
  if (groupError) return fail(groupError, "The member was saved, but the cell group could not be updated.");

  refresh();
  return { ok: true, data: { id: personId! } };
}

export async function saveVisitor(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(id ? P.visitorsUpdate : P.visitorsCreate);
  if (!access) return NOT_ALLOWED;

  const parsed = visitorSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const { first_visit_date, invited_by_person_id, invited_by_name, attendance_type_id, prayer_request, notes, status, ...person } =
    parsed.data;
  // The inviter is either a member (linked to their record) or a typed name, never both.
  const profile = {
    first_visit_date,
    invited_by_person_id,
    invited_by_name: invited_by_person_id ? null : invited_by_name,
    attendance_type_id,
    prayer_request,
    notes,
    status,
  };

  const supabase = await createClient();
  let personId = id;

  if (id) {
    const { data: before } = await supabase.from("people").select("photo_path").eq("id", id).maybeSingle();
    const { data, error } = await supabase
      .from("people")
      .update(person)
      .eq("id", id)
      .eq("person_type", "visitor")
      .select("id")
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return fail("That visitor could not be found, or you don't have access to edit them.");
    await removeOldPhoto(supabase, before?.photo_path, person.photo_path);

    const { error: profileError } = await supabase.from("visitor_profiles").update(profile).eq("person_id", id);
    if (profileError) return fail(profileError);
  } else {
    const { data, error } = await supabase
      .from("people")
      .insert({ ...person, person_type: "visitor", date_first_attended: first_visit_date })
      .select("id")
      .single();
    if (error) return fail(error);
    personId = data.id;

    const { error: profileError } = await supabase
      .from("visitor_profiles")
      .insert({ ...profile, person_id: personId });
    if (profileError) {
      // Don't leave a visitor without their visit details.
      await supabase.from("people").update({ archived_at: new Date().toISOString() }).eq("id", personId);
      return fail(profileError);
    }
  }

  refresh();
  return { ok: true, data: { id: personId! } };
}

/** Archive (soft delete) or restore a member or visitor. */
export async function setPersonArchived(id: string, archived: boolean, disableAccount = false): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(P.membersArchive, P.visitorsUpdate);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  if (archived && disableAccount) {
    // One step in the database: the account is disabled (never deleted) and
    // the member archived. History stays on the member record.
    const { data: userId, error } = await supabase.rpc("archive_member_and_disable_account", { target_person_id: id });
    if (error) return fail(error);
    // RLS already locks the account out; banning also ends its session.
    if (userId && isAdminConfigured) {
      await createAdminClient().auth.admin.updateUserById(userId as string, { ban_duration: "876000h" });
    }
    refresh();
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("people")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  refresh();
  return { ok: true };
}

/** Turns a visitor into a member in place: same record, same history. */
export async function convertVisitor(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(P.membersCreate);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error } = await supabase.rpc("convert_visitor_to_member", { target_person_id: id });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

/** Member portal: update your own contact details. */
export async function updateOwnContact(input: unknown): Promise<ActionResult> {
  const parsed = ownContactSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_person", {
    new_nickname: parsed.data.nickname ?? "",
    new_contact_number: parsed.data.contact_number ?? "",
    new_email: parsed.data.email ?? "",
    new_address: parsed.data.address ?? "",
  });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}
