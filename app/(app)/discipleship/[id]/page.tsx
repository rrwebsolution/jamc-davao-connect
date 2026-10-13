import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Flag, Plus, Sprout, Trash2 } from "lucide-react";
import { deleteMilestone, saveMilestone, setDiscipleship } from "@/app/(app)/module-actions";
import { BackLink, ListEmpty, Panel } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { NoAccess, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, getLookup, signPhotoUrls } from "@/lib/data/common";
import { getPeopleOptions } from "@/lib/data/options";
import { getPerson } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Discipleship profile" };

type HistoryRow = {
  id: string;
  stage_id: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  stage: { name: string } | null;
  mentor: { full_name: string } | null;
};

async function ProfileContent({ params }: Pick<PageProps<"/discipleship/[id]">, "params">) {
  const access = await requireAccess();
  const { id } = await params;
  const person = await getPerson(id, "member");
  if (!person) notFound();

  const isSelf = person.user_id === access.userId;
  if (!isSelf && !can(access, P.discipleshipView, "discipleship.view_assigned")) {
    return <NoAccess />;
  }
  // Shown to anyone who might be allowed; the database decides per person.
  const canEdit = can(access, P.discipleshipManage, "discipleship.manage_assigned");

  const supabase = await createClient();
  const [history, milestones, mentors, stages, mentorOptions, settings, today, photos] = await Promise.all([
    supabase
      .from("discipleship_records")
      .select("id, stage_id, started_at, completed_at, notes, stage:discipleship_stages(name), mentor:people!discipleship_records_mentor_id_fkey(full_name)")
      .eq("person_id", id)
      .order("started_at")
      .order("created_at"),
    supabase.from("discipleship_milestones").select("*").eq("person_id", id).order("achieved_on", { ascending: false }),
    supabase
      .from("mentor_relationships")
      .select("id, started_at, ended_at, mentor:people!mentor_relationships_mentor_id_fkey(full_name)")
      .eq("disciple_id", id)
      .order("started_at", { ascending: false }),
    getLookup("discipleship_stages"),
    canEdit ? getPeopleOptions("member") : [],
    getChurchSettings(),
    getChurchToday(),
    signPhotoUrls([person.photo_path]),
  ]);
  const date = (value: string | null) => formatDate(value, settings.date_format);
  const records = (history.data ?? []) as unknown as HistoryRow[];
  const reached = new Set(records.map((record) => record.stage_id));
  const currentIndex = stages.findIndex((stage) => stage.id === person.discipleship_stage_id);
  const progress = stages.length > 0 && currentIndex >= 0 ? Math.round(((currentIndex + 1) / stages.length) * 100) : 0;

  return (
    <>
      <BackLink href="/discipleship">Back to discipleship</BackLink>

      <div className="mb-4 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:p-6">
        <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} className="size-16 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold sm:text-2xl">{person.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            {person.discipleship_stage_name ?? "No stage yet"}
            {person.mentor_name ? ` · Mentor: ${person.mentor_name}` : " · No mentor"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress along the growth path">
              <div className="h-2 rounded-full bg-chart-1" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {currentIndex >= 0 ? `Stage ${currentIndex + 1} of ${stages.length}` : "Not started"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={`/people/members/${person.id}`} className="text-sm text-link hover:underline">
            Member profile
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Panel
          title="Growth path"
          description="Earlier stages are kept when a member moves on."
          actions={
            canEdit ? (
              <EntityDialog
                title="Update stage or mentor"
                description="Moving to another stage closes the current one with today's date and keeps it in the history."
                fields={[
                  { name: "stage_id", label: "Stage", type: "select", options: stages.map((stage) => ({ value: stage.id, label: stage.name })), emptyLabel: "No stage" },
                  { name: "mentor_id", label: "Mentor", type: "select", options: mentorOptions.filter((option) => option.value !== person.id), emptyLabel: "No mentor" },
                  { name: "notes", label: "Note for this stage", type: "textarea", placeholder: "What marked this step?" },
                ]}
                initial={{ stage_id: person.discipleship_stage_id ?? "", mentor_id: person.mentor_id ?? "", notes: "" }}
                action={setDiscipleship.bind(null, person.id)}
                successMessage="Discipleship updated"
                size="sm"
              >
                <Sprout /> Update
              </EntityDialog>
            ) : null
          }
        >
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stages are set up yet.</p>
          ) : (
            <ol>
              {stages.map((stage, index) => {
                const isCurrent = stage.id === person.discipleship_stage_id;
                const done = reached.has(stage.id) && !isCurrent;
                const entries = records.filter((record) => record.stage_id === stage.id);
                return (
                  <li key={stage.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < stages.length - 1 ? (
                      <span className={`absolute left-[11px] top-6 h-full w-0.5 ${done ? "bg-chart-1" : "bg-border"}`} aria-hidden />
                    ) : null}
                    <span
                      className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold ${
                        isCurrent
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-chart-1 bg-card text-foreground"
                            : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="size-3" aria-hidden /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${isCurrent ? "font-semibold" : done ? "font-medium" : "text-muted-foreground"}`}>
                        {stage.name}
                        {isCurrent ? <span className="ml-2 text-xs font-normal text-muted-foreground">Current</span> : null}
                      </p>
                      {entries.map((entry) => (
                        <p key={entry.id} className="mt-0.5 text-xs text-muted-foreground">
                          {date(entry.started_at)} – {entry.completed_at ? date(entry.completed_at) : "now"}
                          {entry.mentor ? ` · with ${entry.mentor.full_name}` : ""}
                          {entry.notes ? ` · ${entry.notes}` : ""}
                        </p>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Milestones"
            flush
            actions={
              canEdit ? (
                <EntityDialog
                  title="Add a milestone"
                  fields={[
                    { name: "title", label: "Milestone", type: "text", required: true, wide: true, placeholder: "e.g. Water baptism" },
                    { name: "achieved_on", label: "Date", type: "date", required: true },
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]}
                  initial={{ title: "", achieved_on: today, notes: "" }}
                  action={saveMilestone.bind(null, person.id, null)}
                  successMessage="Milestone added"
                  size="sm"
                >
                  <Plus /> Add
                </EntityDialog>
              ) : null
            }
          >
            {(milestones.data ?? []).length === 0 ? (
              <ListEmpty>No milestones recorded yet.</ListEmpty>
            ) : (
              <ul className="divide-y">
                {(milestones.data ?? []).map((milestone) => (
                  <li key={milestone.id} className="flex items-start gap-3 p-3">
                    <Flag className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{milestone.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {date(milestone.achieved_on)}
                        {milestone.notes ? ` · ${milestone.notes}` : ""}
                      </p>
                    </div>
                    {canEdit ? (
                      <ConfirmButton
                        action={deleteMilestone.bind(null, milestone.id)}
                        title="Remove this milestone?"
                        description="This can't be undone."
                        confirmLabel="Remove"
                        successMessage="Milestone removed"
                        destructive
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove milestone"
                      >
                        <Trash2 />
                      </ConfirmButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Mentors" flush>
            {(mentors.data ?? []).length === 0 ? (
              <ListEmpty>No mentor has been assigned.</ListEmpty>
            ) : (
              <ul className="divide-y">
                {(mentors.data ?? []).map((row) => {
                  const mentor = row.mentor as unknown as { full_name: string } | null;
                  return (
                    <li key={row.id} className="p-3 text-sm">
                      <p className="font-medium">{mentor?.full_name ?? "Mentor"}</p>
                      <p className="text-xs text-muted-foreground">
                        {date(row.started_at)} – {row.ended_at ? date(row.ended_at) : "now"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default function DiscipleshipProfilePage({ params }: PageProps<"/discipleship/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <ProfileContent params={params} />
    </PageBoundary>
  );
}
