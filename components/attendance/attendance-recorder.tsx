"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { cn } from "cn";
import { saveAttendance } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/shared/form";
import { EmptyState } from "@/components/shared/states";
import type { RosterPerson } from "@/lib/data/attendance";
import type { Lookup } from "@/lib/types";

type Marks = Record<string, string>;
type View = "all" | "member" | "visitor" | "unmarked";

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "member", label: "Members" },
  { value: "visitor", label: "Visitors" },
  { value: "unmarked", label: "Not marked" },
];

/**
 * The attendance sheet. Marks are kept locally and only the ones that changed
 * are sent on Save, so recording a large service is a single request.
 */
export function AttendanceRecorder({
  sessionId,
  people,
  statuses,
  initialMarks,
  canRecord,
}: {
  sessionId: string;
  people: RosterPerson[];
  statuses: Lookup[];
  initialMarks: Marks;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Marks>(initialMarks);
  const [marks, setMarks] = useState<Marks>(initialMarks);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [pending, startTransition] = useTransition();

  const changed = useMemo(
    () => people.filter((person) => (marks[person.id] ?? null) !== (saved[person.id] ?? null)),
    [people, marks, saved],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return people.filter((person) => {
      if (view === "unmarked" && marks[person.id]) return false;
      if ((view === "member" || view === "visitor") && person.person_type !== view) return false;
      return !term || person.full_name.toLowerCase().includes(term) || (person.member_code ?? "").toLowerCase().includes(term);
    });
  }, [people, marks, query, view]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const person of people) {
      const status = marks[person.id];
      if (status) byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    return byStatus;
  }, [people, marks]);
  const unmarked = people.length - Object.values(counts).reduce((sum, value) => sum + value, 0);
  const absentStatus = statuses.find((status) => status.name.toLowerCase() === "absent") ?? statuses.find((status) => !status.counts_as_present);

  function mark(personId: string, statusId: string) {
    setMarks((current) => {
      const next = { ...current };
      // Clicking the selected status again clears it.
      if (next[personId] === statusId) delete next[personId];
      else next[personId] = statusId;
      return next;
    });
  }

  function markRemaining(statusId: string) {
    setMarks((current) => {
      const next = { ...current };
      for (const person of people) {
        if (!next[person.id]) next[person.id] = statusId;
      }
      return next;
    });
  }

  function save() {
    const payload = changed.map((person) => ({ person_id: person.id, status_id: marks[person.id] ?? null }));
    startTransition(async () => {
      const result = await saveAttendance({ session_id: sessionId, marks: payload });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(marks);
      toast.success(`Attendance saved (${payload.length} ${payload.length === 1 ? "change" : "changes"})`);
      router.refresh();
    });
  }

  if (people.length === 0) {
    return (
      <EmptyState
        title="No one to mark yet."
        description="Add members or register visitors first, then come back to record attendance."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {statuses.map((status) => (
          <span key={status.id} className="rounded-full border bg-card px-3 py-1">
            {status.name} <span className="font-semibold tabular-nums">{counts[status.id] ?? 0}</span>
          </span>
        ))}
        <span className="rounded-full border bg-card px-3 py-1 text-muted-foreground">
          Not marked <span className="font-semibold tabular-nums">{unmarked}</span>
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a person…"
            aria-label="Find a person"
            className="pl-8"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter people">
          {VIEWS.map((item) => (
            <Button
              key={item.value}
              role="tab"
              aria-selected={view === item.value}
              variant={view === item.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {canRecord && absentStatus && unmarked > 0 ? (
          <Button variant="outline" size="sm" className="sm:ml-auto" onClick={() => markRemaining(absentStatus.id)}>
            Mark remaining {unmarked} as {absentStatus.name}
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card py-8 text-center text-sm text-muted-foreground">
          No one matches this search.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {visible.map((person) => (
            <li key={person.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{person.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {person.person_type === "visitor" ? "Visitor" : [person.member_code, person.cell_group_name].filter(Boolean).join(" · ") || "Member"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Attendance for ${person.full_name}`}>
                {statuses.map((status) => {
                  const selected = marks[person.id] === status.id;
                  return (
                    <button
                      key={status.id}
                      type="button"
                      disabled={!canRecord || pending}
                      aria-pressed={selected}
                      onClick={() => mark(person.id, status.id)}
                      className={cn(
                        "h-8 min-w-[4.5rem] flex-1 rounded-lg border px-3 text-xs font-medium transition-colors max-md:h-11 max-md:text-sm sm:flex-none",
                        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
                        selected
                          ? status.counts_as_present
                            ? "border-success bg-success text-white dark:text-black"
                            : "border-destructive bg-destructive text-white dark:text-black"
                          : "bg-background hover:bg-muted",
                      )}
                    >
                      {status.name}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canRecord ? (
        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {changed.length === 0 ? "All changes saved" : `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}`}
          </p>
          <div className="flex gap-2">
            {changed.length > 0 ? (
              <Button variant="outline" onClick={() => setMarks(saved)} disabled={pending}>
                Discard
              </Button>
            ) : null}
            <PendingButton pending={pending} pendingText="Saving…" disabled={changed.length === 0} onClick={save}>
              Save attendance
            </PendingButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
