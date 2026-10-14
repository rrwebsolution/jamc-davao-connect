import Link from "next/link";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState } from "@/components/shared/states";
import { getPersonAttendance } from "@/lib/data/attendance";
import { formatDate, formatMonth } from "@/lib/format";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** One person's attendance statistics and recent history. */
export async function AttendanceSummary({
  personId,
  dateFormat,
  threshold,
}: {
  personId: string;
  dateFormat: string;
  threshold: number;
}) {
  const { stats, rows } = await getPersonAttendance(personId);

  if (!stats || stats.total === 0) {
    return <EmptyState title="No attendance recorded yet." description="Records appear here once attendance is taken for a service or event." />;
  }

  const flagged = stats.consecutive_absences >= threshold;
  const busiest = Math.max(1, ...stats.monthly.map((month) => month.present + month.absent));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Attendance rate" value={stats.attendance_rate === null ? "—" : `${stats.attendance_rate}%`} note={`${stats.total} sessions recorded`} />
        <Stat label="Total present" value={String(stats.present)} note={stats.last_attended ? `Last attended ${formatDate(stats.last_attended, dateFormat)}` : undefined} />
        <Stat label="Total absent" value={String(stats.absent)} />
        <Stat
          label="Consecutive absences"
          value={String(stats.consecutive_absences)}
          note={flagged ? `Reached the follow-up threshold (${threshold})` : `Follow-up threshold: ${threshold}`}
        />
      </div>

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="text-base font-semibold">Monthly attendance</h2>
        <p className="text-sm text-muted-foreground">Sessions attended in each of the last six months.</p>
        <table className="mt-4 w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>Month</th>
              <th>Attended</th>
            </tr>
          </thead>
          <tbody>
            {stats.monthly.map((month) => (
              <tr key={month.month}>
                <td className="w-16 py-1.5 text-muted-foreground">{formatMonth(month.month)}</td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-chart-1"
                        style={{ width: `${(month.present / busiest) * 100}%` }}
                      />
                    </div>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">
                      {month.present} of {month.present + month.absent}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b p-4 text-base font-semibold">Recent history</h2>
        <ul className="scroll-list divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <Link href={`/attendance/services/${row.session_id}`} className="block truncate font-medium hover:underline">
                  {row.session_title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatDate(row.session_date, dateFormat)} · {row.attendance_type_name}
                </p>
              </div>
              <StatusPill tone={row.counts_as_present ? "success" : "danger"}>{row.status_name}</StatusPill>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
