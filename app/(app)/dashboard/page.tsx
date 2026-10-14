import type { ReactNode } from "react";
import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Cake, CalendarCheck, CalendarDays, FlaskConical, HeartHandshake, Minus, UserCheck, UserPlus, Users, UsersRound, type LucideIcon } from "lucide-react";
import { Bars, RankedBars, TrendLine, type ChartPoint } from "@/components/dashboard/charts";
import { VisitorStatusPill } from "@/components/people/visitor-status";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, signPhotoUrls } from "@/lib/data/common";
import { FOLLOW_UP_TYPES, labelOf, PRIORITIES } from "@/lib/data/options";
import { formatDate, formatDayMonth, formatMonth, percentChange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { VisitorStatus } from "@/lib/types";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Dashboard" };

type ServiceSummary = { id: string; title: string; date: string; present: number } | null;
type Stats = {
  today: string;
  total_members: number;
  active_members: number;
  new_members_this_month: number;
  new_members_last_month: number;
  new_visitors_this_month: number;
  new_visitors_last_month: number;
  latest_service: ServiceSummary;
  previous_service: ServiceSummary;
  active_cell_groups: number;
  attendance_trend: { date: string; title: string; present: number; absent: number }[];
  membership_growth: { month: string; new_members: number; total_members: number }[];
  visitor_trend: { month: string; visitors: number }[];
  cell_group_participation: { name: string; members: number }[];
  discipleship_progress: { stage: string; members: number }[];
};

function Trend({ change, label }: { change: number | null; label: string }) {
  if (change === null) {
    return <p className="mt-2 text-xs text-muted-foreground">{label}</p>;
  }
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const tone = change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
      <span className={`inline-flex items-center font-medium ${tone}`}>
        <Icon className="size-3.5" aria-hidden />
        {change > 0 ? "+" : ""}
        {change}%
      </span>
      {label}
    </p>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums sm:mt-2 sm:text-3xl">{value}</p>
      {children}
    </>
  );
  const className = "block rounded-xl border bg-card p-3 shadow-xs sm:p-4";
  return href ? (
    <Link href={href} data-reveal="" className={`${className} motion-card hover:border-ring`}>
      {body}
    </Link>
  ) : (
    <div data-reveal="" className={className}>
      {body}
    </div>
  );
}

function ChartCard({
  title,
  description,
  data,
  columns,
  empty,
  children,
}: {
  title: string;
  description: string;
  data: ChartPoint[];
  columns: [string, string];
  empty: string;
  children: ReactNode;
}) {
  const hasData = data.some((point) => point.value > 0);
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      {hasData ? (
        <>
          {children}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View as table</summary>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 font-medium">{columns[0]}</th>
                  <th className="py-1 text-right font-medium">{columns[1]}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((point, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    <td className="py-1">{point.detail ?? point.label}</td>
                    <td className="py-1 text-right tabular-nums">{point.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function ListCard({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm text-link hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const emptyRow = (text: string) => <p className="p-6 text-center text-sm text-muted-foreground">{text}</p>;

async function DashboardContent() {
  const access = await requireAccess();
  const seesMembers = can(access, P.membersView, P.membersViewAssigned);
  const seesVisitors = can(access, P.visitorsView);
  const seesAttendance = can(access, P.attendanceView, P.attendanceViewAssigned);
  const seesEvents = can(access, P.eventsView, "events.manage");
  if (!seesMembers && !seesVisitors && !seesAttendance && !seesEvents) {
    return <NoAccess />;
  }

  const supabase = await createClient();
  // One round trip for everything that doesn't depend on another result.
  const [statsResult, settings, extrasResult, followUps, demo, approvals] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    getChurchSettings(),
    supabase.rpc("dashboard_extras"),
    // Follow-ups are visible to whoever they are assigned to, so these are
    // loaded for everyone and scoped by RLS.
    supabase
      .from("follow_up_details")
      .select("id, person_name, follow_up_type, assigned_to_name, due_date, due_state, priority")
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase.rpc("has_demo_data"),
    can(access, P.usersManage)
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending").eq("registration_source", "self_signup")
      : null,
  ]);
  const stats = statsResult.data as Stats | null;
  if (statsResult.error || !stats) {
    console.error("dashboard_stats failed", describeError(statsResult.error));
    return <LoadError what="the dashboard" />;
  }

  // Every figure below comes from the database under the viewer's own access,
  // so a cell leader sees totals for the groups they lead.
  const [birthdays, visitors, events] = await Promise.all([
    seesMembers ? supabase.rpc("upcoming_birthdays", { days_ahead: 30 }).limit(6) : null,
    seesVisitors
      ? supabase
          .from("people_directory")
          .select("id, full_name, contact_number, first_visit_date, visitor_status")
          .eq("person_type", "visitor")
          .is("archived_at", null)
          .order("first_visit_date", { ascending: false })
          .limit(5)
      : null,
    seesEvents
      ? supabase
          .from("events")
          .select("id, name, event_date, venue, status")
          .is("archived_at", null)
          .in("status", ["upcoming", "ongoing"])
          .gte("event_date", stats.today)
          .order("event_date")
          .limit(5)
      : null,
  ]);

  const extras = (extrasResult.data ?? {}) as { pending_follow_ups?: number; overdue_follow_ups?: number; upcoming_events?: number };
  const birthdayRows = (birthdays?.data ?? []) as {
    id: string;
    full_name: string;
    photo_path: string | null;
    next_birthday: string;
    turning_age: number;
  }[];
  const photos = await signPhotoUrls(birthdayRows.map((row) => row.photo_path));
  const scopeNote = can(access, P.membersView) ? "" : " in your groups";
  // Greeting by the church's clock, not the server's.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: settings.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col">
      <div className="max-md:hidden">
        <PageHeader title="Dashboard" description={`${settings.church_name} · ${formatDate(stats.today, settings.date_format)}`} />
      </div>
      <div className="mb-4 md:hidden">
        <p className="text-sm text-muted-foreground">{greeting},</p>
        <h1 className="text-2xl font-semibold tracking-tight">{access.fullName.split(" ")[0]}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{formatDate(stats.today, settings.date_format)}</p>
      </div>

      {demo.data === true ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium">Demo data is loaded.</span> People with IDs starting <span className="font-mono">DEMO-</span>,
            groups ending in “(Demo)” and references starting <span className="font-mono">DEMO-</span> are fictional and are not
            real church records.
          </span>
        </p>
      ) : null}

      <div data-reveal-list="" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {seesMembers ? (
          <>
            <StatCard icon={Users} label={`Total members${scopeNote}`} value={String(stats.total_members)} href="/people/members">
              <Trend
                change={percentChange(stats.new_members_this_month, stats.new_members_last_month)}
                label={`${stats.new_members_this_month} new this month · ${stats.new_members_last_month} last month`}
              />
            </StatCard>
            <StatCard icon={UserCheck} label="Active members" value={String(stats.active_members)} href="/people/members?status=active">
              <p className="mt-2 text-xs text-muted-foreground">
                {stats.total_members > 0 ? `${Math.round((stats.active_members / stats.total_members) * 100)}% of members` : "No members yet"}
              </p>
            </StatCard>
          </>
        ) : null}
        {seesVisitors ? (
          <StatCard icon={UserPlus} label="New visitors this month" value={String(stats.new_visitors_this_month)} href="/people/visitors">
            <Trend
              change={percentChange(stats.new_visitors_this_month, stats.new_visitors_last_month)}
              label={`vs ${stats.new_visitors_last_month} last month`}
            />
          </StatCard>
        ) : null}
        {seesAttendance ? (
          <StatCard
            icon={CalendarCheck}
            label="Sunday attendance"
            value={stats.latest_service ? String(stats.latest_service.present) : "—"}
            href={stats.latest_service ? `/attendance/services/${stats.latest_service.id}` : "/attendance/services"}
          >
            {stats.latest_service ? (
              <Trend
                change={stats.previous_service ? percentChange(stats.latest_service.present, stats.previous_service.present) : null}
                label={
                  stats.previous_service
                    ? `${formatDayMonth(stats.latest_service.date)} · vs ${stats.previous_service.present} on ${formatDayMonth(stats.previous_service.date)}`
                    : formatDate(stats.latest_service.date, settings.date_format)
                }
              />
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No service recorded yet</p>
            )}
          </StatCard>
        ) : null}
        {seesMembers ? (
          <StatCard icon={UsersRound} label="Active cell groups" value={String(stats.active_cell_groups)} href="/groups">
            <p className="mt-2 text-xs text-muted-foreground">
              {stats.cell_group_participation.reduce((sum, group) => sum + group.members, 0)} members in a group
            </p>
          </StatCard>
        ) : null}
        <StatCard icon={HeartHandshake} label="Pending follow-ups" value={String(extras.pending_follow_ups ?? 0)} href="/care/follow-ups">
          <p className={`mt-2 text-xs ${extras.overdue_follow_ups ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {extras.overdue_follow_ups ? `${extras.overdue_follow_ups} overdue` : "None overdue"}
          </p>
        </StatCard>
        {approvals ? (
          <StatCard icon={UserCheck} label="Pending account approvals" value={String(approvals.count ?? 0)} href="/admin/approvals">
            <p className={`mt-2 text-xs ${approvals.count ? "font-medium text-highlight" : "text-muted-foreground"}`}>
              {approvals.count ? "Review registrations" : "Nothing waiting"}
            </p>
          </StatCard>
        ) : null}
        {seesEvents ? (
          <StatCard icon={CalendarDays} label="Upcoming events" value={String(extras.upcoming_events ?? 0)} href="/events">
            <p className="mt-2 text-xs text-muted-foreground">
              {(events?.data ?? [])[0] ? `Next: ${(events?.data ?? [])[0].name}` : "Nothing scheduled"}
            </p>
          </StatCard>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 max-md:order-2 lg:grid-cols-2">
        {seesAttendance ? (
          <ChartCard
            title="Attendance trend"
            description="People present at each of the last Sunday services."
            columns={["Service", "Present"]}
            empty="No attendance recorded yet."
            data={stats.attendance_trend.map((row) => ({
              label: formatDayMonth(row.date),
              value: row.present,
              detail: `${row.title} · ${formatDate(row.date, settings.date_format)}`,
            }))}
          >
            <TrendLine
              unit="present"
              data={stats.attendance_trend.map((row) => ({
                label: formatDayMonth(row.date),
                value: row.present,
                detail: `${row.title} · ${formatDate(row.date, settings.date_format)}`,
              }))}
            />
          </ChartCard>
        ) : null}
        {seesMembers ? (
          <ChartCard
            title="Membership growth"
            description="Total members at the end of each month."
            columns={["Month", "Members"]}
            empty="No members yet."
            data={stats.membership_growth.map((row) => ({ label: formatMonth(row.month), value: row.total_members }))}
          >
            <TrendLine unit="members" data={stats.membership_growth.map((row) => ({ label: formatMonth(row.month), value: row.total_members }))} />
          </ChartCard>
        ) : null}
        {seesVisitors ? (
          <ChartCard
            title="Visitor trend"
            description="First-time visitors per month."
            columns={["Month", "Visitors"]}
            empty="No visitors registered yet."
            data={stats.visitor_trend.map((row) => ({ label: formatMonth(row.month), value: row.visitors }))}
          >
            <Bars unit="visitors" data={stats.visitor_trend.map((row) => ({ label: formatMonth(row.month), value: row.visitors }))} />
          </ChartCard>
        ) : null}
        {seesMembers ? (
          <ChartCard
            title="Discipleship progress"
            description="Members currently at each stage."
            columns={["Stage", "Members"]}
            empty="No members have a discipleship stage yet."
            data={stats.discipleship_progress.map((row) => ({ label: row.stage, value: row.members }))}
          >
            <RankedBars unit="members" data={stats.discipleship_progress.map((row) => ({ label: row.stage, value: row.members }))} />
          </ChartCard>
        ) : null}
        {seesMembers ? (
          <ChartCard
            title="Cell group participation"
            description="Members in each active cell group."
            columns={["Cell group", "Members"]}
            empty="No members are assigned to a cell group yet."
            data={stats.cell_group_participation.map((row) => ({ label: row.name, value: row.members }))}
          >
            <RankedBars unit="members" data={stats.cell_group_participation.map((row) => ({ label: row.name, value: row.members }))} />
          </ChartCard>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 max-md:order-1 lg:grid-cols-2">
        {seesMembers ? (
          <ListCard title="Upcoming birthdays" href="/people/birthdays" linkLabel="View all">
            {birthdayRows.length === 0 ? (
              emptyRow("No birthdays in the next 30 days.")
            ) : (
              <ul className="scroll-list divide-y">
                {birthdayRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 p-3">
                    <PersonAvatar name={row.full_name} src={row.photo_path ? photos[row.photo_path] : null} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/people/members/${row.id}`} className="block truncate text-sm font-medium hover:underline">
                        {row.full_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">Turning {row.turning_age}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Cake className="size-3.5" aria-hidden />
                      {row.next_birthday === stats.today ? "Today" : formatDayMonth(row.next_birthday)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ListCard>
        ) : null}
        {seesVisitors ? (
          <ListCard title="Recent visitors" href="/people/visitors" linkLabel="View all">
            {(visitors?.data ?? []).length === 0 ? (
              emptyRow("No visitors registered yet.")
            ) : (
              <ul className="scroll-list divide-y">
                {(visitors?.data ?? []).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <Link href={`/people/visitors/${row.id}`} className="block truncate text-sm font-medium hover:underline">
                        {row.full_name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {[formatDate(row.first_visit_date, settings.date_format), row.contact_number].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <VisitorStatusPill status={row.visitor_status as VisitorStatus | null} />
                  </li>
                ))}
              </ul>
            )}
          </ListCard>
        ) : null}
        <ListCard title="Pending follow-ups" href="/care/follow-ups" linkLabel="View all">
          {(followUps.data ?? []).length === 0 ? (
            emptyRow("No pending follow-ups.")
          ) : (
            <ul className="scroll-list divide-y">
              {(followUps.data ?? []).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <Link href={`/care/follow-ups?focus=${row.id}`} className="block truncate text-sm font-medium hover:underline">
                      {row.person_name ?? "Follow-up"}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {labelOf(FOLLOW_UP_TYPES, row.follow_up_type)} · {row.assigned_to_name ?? "Unassigned"}
                      {row.priority === "high" || row.priority === "urgent" ? ` · ${labelOf(PRIORITIES, row.priority)} priority` : ""}
                    </p>
                  </div>
                  {row.due_state === "overdue" ? (
                    <StatusPill tone="danger">Overdue</StatusPill>
                  ) : row.due_state === "today" ? (
                    <StatusPill tone="warning">Due today</StatusPill>
                  ) : row.due_date ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(row.due_date, settings.date_format)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </ListCard>
        {seesEvents ? (
          <ListCard title="Upcoming events" href="/events" linkLabel="View all">
            {(events?.data ?? []).length === 0 ? (
              emptyRow("No upcoming events.")
            ) : (
              <ul className="scroll-list divide-y">
                {(events?.data ?? []).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <Link href={`/events/${row.id}`} className="block truncate text-sm font-medium hover:underline">
                        {row.name}
                      </Link>
                      {row.venue ? <p className="truncate text-xs text-muted-foreground">{row.venue}</p> : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.event_date === stats.today ? "Today" : formatDate(row.event_date, settings.date_format)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ListCard>
        ) : null}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Dashboard" variant="dashboard" />}>
      <DashboardContent />
    </PageBoundary>
  );
}