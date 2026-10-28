"use client";

import { useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { X } from "lucide-react";
import { cn } from "cn";
import { axis, AXIS_FONT_SIZE, useChartMotion } from "@/components/dashboard/charts";
import { buttonVariants } from "@/components/ui/button";
import type { RecordsSummary } from "@/lib/data/attendance";
import { formatDayMonth, formatMonth } from "@/lib/format";

type Params = Record<string, string | undefined>;

const counts = new Intl.NumberFormat("en-PH");
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const longDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** A value axis wide enough for its longest number. */
function countAxisWidth(max: number) {
  return Math.ceil(Math.max(counts.format(Math.ceil(max * 1.25)).length, 1) * AXIS_FONT_SIZE * 0.62) + 12;
}

function hrefWith(pathname: string, params: Params, changes: Params) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes, page: undefined })) {
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Applies a filter chosen on a chart: the records below follow it. */
function useChartFilter(params: Params) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return {
    pending,
    apply: (changes: Params) => startTransition(() => router.push(hrefWith(pathname, params, changes), { scroll: false })),
  };
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; strong?: boolean }[] }) {
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className={cn("flex items-center justify-between gap-4", row.strong && "mt-1 border-t pt-1 font-semibold")}>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {row.color ? <span className="size-2 rounded-full" style={{ background: row.color }} aria-hidden /> : null}
            {row.label}
          </span>
          <span className="tabular-nums">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/** A chart card: title, description and an optional action, then the chart. */
export function ChartCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-reveal="" className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-xs sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

function NoData({ children }: { children: ReactNode }) {
  return <p className="flex h-40 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">{children}</p>;
}

const SERIES = {
  members: { label: "Present members", color: "var(--chart-1)" },
  visitors: { label: "Visitors", color: "var(--chart-2)" },
  total: { label: "Total attendance", color: "var(--muted-foreground)" },
};

// --- Attendance trend -------------------------------------------------------

export function AttendanceTrend({ data, params }: { data: RecordsSummary["trend"]; params: Params }) {
  const motion = useChartMotion();
  const { apply } = useChartFilter(params);
  const points = data.map((point) => ({ ...point, label: formatDayMonth(point.date), total: point.members + point.visitors }));
  const max = Math.max(0, ...points.map((point) => point.total));

  if (points.length === 0) return <NoData>No attendance in this period.</NoData>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart
        data={points}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        className="cursor-pointer"
        onClick={(state) => {
          // Recharts reports the index as a number or a numeric string.
          const index = Number(state.activeIndex ?? state.activeTooltipIndex);
          const point = Number.isInteger(index) ? points[index] : undefined;
          if (!point) return;
          // One session that day opens its records; several narrow the list to the day.
          apply(point.session_id ? { session: point.session_id } : { range: "custom", from: point.date, to: point.date });
        }}
      >
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={20} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={countAxisWidth(max)} tickFormatter={(value: number) => counts.format(value)} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipBox
                title={longDate(point.date)}
                rows={[
                  { label: SERIES.members.label, value: counts.format(point.members), color: SERIES.members.color },
                  { label: SERIES.visitors.label, value: counts.format(point.visitors), color: SERIES.visitors.color },
                  { label: SERIES.total.label, value: counts.format(point.total), strong: true },
                ]}
              />
            );
          }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: AXIS_FONT_SIZE }}
          formatter={(value: string) => <span className="text-muted-foreground">{SERIES[value as keyof typeof SERIES]?.label ?? value}</span>}
        />
        <Line type="monotone" dataKey="total" stroke={SERIES.total.color} strokeWidth={1.5} strokeDasharray="4 4" dot={false} {...motion} />
        <Line type="monotone" dataKey="members" stroke={SERIES.members.color} strokeWidth={2} dot={{ r: 3, fill: SERIES.members.color, stroke: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 5 }} {...motion} />
        <Line type="monotone" dataKey="visitors" stroke={SERIES.visitors.color} strokeWidth={2} dot={{ r: 3, fill: SERIES.visitors.color, stroke: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 5 }} {...motion} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- Donuts -----------------------------------------------------------------

type Slice = { key: string; name: string; value: number; color: string; changes: Params; active: boolean };

/** A donut with its legend as buttons: name, count and share, so colour is never the only cue. */
function Donut({ slices, centerLabel, params }: { slices: Slice[]; centerLabel: string; params: Params }) {
  const motion = useChartMotion();
  const { apply } = useChartFilter(params);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <NoData>No marks in this period.</NoData>;

  return (
    // The legend sits beside the donut only when the card is wide enough for full names.
    <div className="@container">
    <div className="flex flex-col items-center gap-4 @md:flex-row">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={slices.filter((slice) => slice.value > 0).length > 1 ? 2 : 0}
              stroke="var(--card)"
              strokeWidth={2}
              className="cursor-pointer outline-none"
              onClick={(_, index) => apply(slices[index].changes)}
              {...motion}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} opacity={slices.some((s) => s.active) && !slice.active ? 0.35 : 1} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const slice = active ? (payload?.[0]?.payload as Slice | undefined) : undefined;
                if (!slice) return null;
                return <TooltipBox title={slice.name} rows={[{ label: "Marks", value: `${counts.format(slice.value)} (${percent(slice.value, total)}%)`, color: slice.color }]} />;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{counts.format(total)}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1">
        {slices.map((slice) => (
          <li key={slice.key}>
            <button
              type="button"
              onClick={() => apply(slice.changes)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted max-md:min-h-11",
                slice.active && "bg-muted font-medium",
              )}
              aria-pressed={slice.active}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{slice.name}</span>
              <span className="tabular-nums">{counts.format(slice.value)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{percent(slice.value, total)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}

/** Late and excused have their own colours; other present marks green, the rest red. */
function statusColor(status: RecordsSummary["statuses"][number]) {
  if (/late/i.test(status.name)) return "var(--warning)";
  if (/excus/i.test(status.name)) return "var(--info)";
  return status.counts_as_present ? "var(--success)" : "var(--destructive)";
}

export function AttendanceStatus({ statuses, params }: { statuses: RecordsSummary["statuses"]; params: Params }) {
  return (
    <Donut
      centerLabel="marks"
      params={params}
      slices={statuses.map((status) => ({
        key: status.id,
        name: status.name,
        value: status.total,
        color: statusColor(status),
        changes: { status: status.id },
        active: params.status === status.id,
      }))}
    />
  );
}

export function MembersVisitors({ members, visitors, params }: { members: number; visitors: number; params: Params }) {
  return (
    <Donut
      centerLabel="present"
      params={params}
      slices={[
        { key: "member", name: "Members", value: members, color: SERIES.members.color, changes: { who: "member" }, active: params.who === "member" },
        { key: "visitor", name: "Visitors", value: visitors, color: SERIES.visitors.color, changes: { who: "visitor" }, active: params.who === "visitor" },
      ]}
    />
  );
}

// --- Attendance by cell group -----------------------------------------------

export function GroupRates({ groups, params }: { groups: RecordsSummary["groups"]; params: Params }) {
  const motion = useChartMotion();
  const { apply } = useChartFilter(params);
  // Rates, not totals, so groups of different sizes compare fairly.
  const data = groups
    .map((group) => ({ ...group, rate: percent(group.present, group.total) }))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  if (data.length === 0) return <NoData>No one in a cell group was marked in this period.</NoData>;

  const labelWidth = Math.min(160, Math.max(64, Math.ceil(Math.max(...data.map((group) => group.name.length)) * AXIS_FONT_SIZE * 0.6) + 16));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30 + 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} interval={0} tick={axis} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}%`} />
        {/* Every group is named: interval 0 stops Recharts skipping labels it thinks are crowded. */}
        <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} width={labelWidth} interval={0} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
          content={({ active, payload }) => {
            const group = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            if (!group) return null;
            return (
              <TooltipBox
                title={group.name}
                rows={[
                  { label: "Present", value: counts.format(group.present) },
                  { label: "Marked", value: counts.format(group.total) },
                  { label: "Attendance rate", value: `${group.rate}%`, strong: true },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={16} className="cursor-pointer" onClick={(_, index) => apply({ group: data[index].id })} {...motion}>
          {data.map((group) => (
            <Cell key={group.id} fill="var(--chart-1)" opacity={params.group && params.group !== group.id ? 0.35 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Monthly ----------------------------------------------------------------

export function MonthlyAttendance({ monthly }: { monthly: RecordsSummary["monthly"] }) {
  const motion = useChartMotion();
  const data = monthly.map((month) => ({ ...month, label: formatMonth(month.month) }));
  const max = Math.max(0, ...data.map((month) => Math.max(month.members, month.visitors)));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={8} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={countAxisWidth(max)} tickFormatter={(value: number) => counts.format(value)} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
          content={({ active, payload }) => {
            const month = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            if (!month) return null;
            return (
              <TooltipBox
                title={new Date(`${month.month}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                rows={[
                  { label: "Members", value: counts.format(month.members), color: SERIES.members.color },
                  { label: "Visitors", value: counts.format(month.visitors), color: SERIES.visitors.color },
                  { label: "Total", value: counts.format(month.members + month.visitors), strong: true },
                ]}
              />
            );
          }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: AXIS_FONT_SIZE }}
          formatter={(value: string) => <span className="text-muted-foreground">{value === "members" ? "Members" : "Visitors"}</span>}
        />
        <Bar dataKey="members" fill={SERIES.members.color} radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
        <Bar dataKey="visitors" fill={SERIES.visitors.color} radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Active chart filters ---------------------------------------------------

/** The filters a chart can set, shown as removable chips with "Clear chart filters". */
export function ChartFilterChips({ params, chips }: { params: Params; chips: { key: string; label: string }[] }) {
  const pathname = usePathname();
  if (chips.length === 0) return null;
  const cleared = Object.fromEntries(chips.map((chip) => [chip.key, undefined]));
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Showing:</span>
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={hrefWith(pathname, params, { [chip.key]: undefined })}
          scroll={false}
          className="inline-flex h-7 items-center gap-1 rounded-full border bg-card pl-3 pr-2 text-xs font-medium transition-colors hover:bg-muted max-md:h-9"
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label} <X className="size-3.5" aria-hidden />
        </Link>
      ))}
      <Link href={hrefWith(pathname, params, cleared)} scroll={false} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Clear chart filters
      </Link>
    </div>
  );
}
