"use server";

import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/session";
import { can, P } from "@/lib/auth/permissions";
import { cleanSearchTerm } from "@/lib/data/common";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

type SearchHit = { title: string; detail?: string; href: string };
export type SearchResults = {
  members: SearchHit[];
  visitors: SearchHit[];
  groups: SearchHit[];
  services: SearchHit[];
  events: SearchHit[];
  ministries: SearchHit[];
};

const EMPTY: SearchResults = { members: [], visitors: [], groups: [], services: [], events: [], ministries: [] };

/**
 * Searches across modules. Every query runs as the signed-in user, so RLS
 * decides what can be found; the permission checks only skip pointless calls.
 */
export async function globalSearch(rawTerm: string): Promise<SearchResults> {
  const access = await getAccess();
  const term = cleanSearchTerm(rawTerm);
  if (!access || term.length < 2) {
    return EMPTY;
  }

  const supabase = await createClient();
  const pattern = `%${term}%`;

  const [people, groups, services, events, ministries] = await Promise.all([
    can(access, P.membersView, P.membersViewAssigned, P.visitorsView)
      ? supabase
          .from("people")
          .select("id, full_name, person_type, member_code, contact_number")
          .is("archived_at", null)
          .or(`full_name.ilike.${pattern},member_code.ilike.${pattern},contact_number.ilike.${pattern}`)
          .order("full_name")
          .limit(12)
      : null,
    supabase.from("cell_groups").select("id, name, location").is("archived_at", null).ilike("name", pattern).limit(5),
    can(access, P.attendanceView, P.attendanceViewAssigned)
      ? supabase
          .from("attendance_sessions")
          .select("id, title, session_date")
          .is("archived_at", null)
          .ilike("title", pattern)
          .order("session_date", { ascending: false })
          .limit(5)
      : null,
    can(access, P.eventsView, "events.manage")
      ? supabase
          .from("events")
          .select("id, name, event_date")
          .is("archived_at", null)
          .ilike("name", pattern)
          .order("event_date", { ascending: false })
          .limit(5)
      : null,
    can(access, P.ministriesView, P.ministriesManage)
      ? supabase.from("ministries").select("id, name").is("archived_at", null).ilike("name", pattern).limit(5)
      : null,
  ]);

  const results: SearchResults = { members: [], visitors: [], groups: [], services: [], events: [], ministries: [] };

  for (const person of people?.data ?? []) {
    if (person.person_type === "member") {
      results.members.push({
        title: person.full_name,
        detail: person.member_code ?? undefined,
        href: `/people/members/${person.id}`,
      });
    } else {
      results.visitors.push({
        title: person.full_name,
        detail: person.contact_number ?? undefined,
        href: `/people/visitors/${person.id}`,
      });
    }
  }
  for (const group of groups.data ?? []) {
    results.groups.push({
      title: group.name,
      detail: group.location ?? undefined,
      href: `/groups/${group.id}`,
    });
  }
  for (const session of services?.data ?? []) {
    results.services.push({
      title: session.title,
      detail: formatDate(session.session_date),
      href: `/attendance/services/${session.id}`,
    });
  }

  for (const event of events?.data ?? []) {
    results.events.push({ title: event.name, detail: formatDate(event.event_date), href: `/events/${event.id}` });
  }
  for (const ministry of ministries?.data ?? []) {
    results.ministries.push({ title: ministry.name, href: `/ministries/${ministry.id}` });
  }

  return results;
}
