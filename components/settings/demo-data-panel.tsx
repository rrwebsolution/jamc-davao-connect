"use client";

import { FlaskConical, Trash2 } from "lucide-react";
import { removeDemoData } from "@/app/(app)/admin/settings/actions";
import { clearPageCache } from "@/components/app/page-boundary";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FormSection } from "@/components/shared/form";

export type DemoSummary = {
  members: number;
  visitors: number;
  cell_groups: number;
  attendance_sessions: number;
  follow_ups: number;
  care_records: number;
  events: number;
  giving_records: number;
  expenses: number;
  accounts?: number;
  transfers?: number;
};

const LABELS: [keyof DemoSummary, string][] = [
  ["members", "Members"],
  ["visitors", "Visitors"],
  ["cell_groups", "Cell groups"],
  ["attendance_sessions", "Attendance sessions"],
  ["follow_ups", "Follow-ups"],
  ["care_records", "Care records"],
  ["events", "Events"],
  ["giving_records", "Giving records"],
  ["expenses", "Expenses"],
  ["accounts", "Financial accounts"],
  ["transfers", "Transfers"],
];

/** Shows what demo data is loaded and lets a Super Admin remove it. */
export function DemoDataPanel({ summary }: { summary: DemoSummary }) {
  const total = LABELS.reduce((sum, [key]) => sum + Number(summary[key] ?? 0), 0);

  return (
    <FormSection
      title="Demo data"
      description="Fictional records loaded for presentations and testing. They are marked in the database, so they can be removed without touching real church records."
    >
      {total === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <FlaskConical className="size-4 shrink-0" aria-hidden />
          No demo data is loaded. Everything in the system is real data.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {LABELS.map(([key, label]) => (
              <div key={key} className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{summary[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Removing also clears what belongs to these records: attendance marks, group memberships, ministry assignments,
            discipleship history and related notifications. Categories, ministries and stages are settings and are kept.
          </p>
          <div className="mt-4">
            <ConfirmButton
              action={async () => {
                const result = await removeDemoData();
                // Pages remembered for instant navigation still show the demo rows.
                if (result.ok) clearPageCache();
                return result;
              }}
              title="Remove all demo data?"
              description="Every demo member, visitor, cell group, attendance session, follow-up, care record, event and finance record will be permanently deleted. Real records are not affected. This can't be undone, but the demo data can be loaded again with npm run demo:seed."
              confirmLabel="Remove demo data"
              successMessage="Demo data removed"
              destructive
              variant="destructive"
            >
              <Trash2 /> Remove demo data
            </ConfirmButton>
          </div>
        </>
      )}
    </FormSection>
  );
}
