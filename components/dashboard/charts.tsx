"use client";

import { useSyncExternalStore } from "react";
import type { TooltipContentProps } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/components/shared/blocks";

export type ChartPoint = { label: string; value: number; detail?: string };

const never = () => () => {};
/**
 * Whether charts may animate: not when animations are off in Appearance
 * settings, and not when the device asks for reduced motion. The drawing-in
 * happens when a chart appears or its data changes, never on hover.
 */
export function useChartMotion() {
  const allowed = useSyncExternalStore(
    never,
    () => document.documentElement.dataset.motion !== "off" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  return { isAnimationActive: allowed, animationDuration: 500, animationEasing: "ease-out" as const };
}

// Every dashboard chart shows one measure, so each uses a single series in
// the brand colour and is named by its card title rather than a legend.
export const AXIS_FONT_SIZE = 12;
export const axis = { fontSize: AXIS_FONT_SIZE, fill: "var(--muted-foreground)" };

// Peso axes show whole amounts (₱1,500) and switch to a compact form (₱25K)
// from ten thousand up; the tooltip always shows the exact amount.
const PESOS = "pesos";
const wholePesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const compactPesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 });
const counts = new Intl.NumberFormat("en-PH");

function axisFormatter(unit: string, data: ChartPoint[]) {
  const max = Math.max(0, ...data.map((point) => point.value));
  if (unit !== PESOS) return (value: number) => counts.format(value);
  return (value: number) => (max >= 10_000 ? compactPesos : wholePesos).format(value);
}

/**
 * A value axis wide enough for its longest label, so amounts are never cut
 * off at the left edge. The widest tick is at most a little over the maximum.
 */
function valueAxis(unit: string, data: ChartPoint[]) {
  const format = axisFormatter(unit, data);
  const max = Math.max(0, ...data.map((point) => point.value));
  const longest = Math.max(format(max).length, format(max * 1.25).length, 1);
  return { tickFormatter: format, width: Math.ceil(longest * AXIS_FONT_SIZE * 0.62) + 12 };
}

function TooltipCard({ active, payload, label, unit }: TooltipContentProps<number, string> & { unit: string }) {
  const point = payload?.[0];
  if (!active || !point) return null;
  const value = Number(point.value);
  return (
    <div className="min-w-32 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{(point.payload as ChartPoint | undefined)?.detail ?? label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-full bg-chart-1" aria-hidden />
        <span className="capitalize">{unit === PESOS ? "Amount" : unit}</span>
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{unit === PESOS ? money(value) : counts.format(value)}</p>
    </div>
  );
}

function ChartTooltip({ unit }: { unit: string }) {
  return (
    <Tooltip
      cursor={{ stroke: "var(--border)", fill: "var(--muted)", fillOpacity: 0.5 }}
      content={(props) => <TooltipCard {...(props as TooltipContentProps<number, string>)} unit={unit} />}
    />
  );
}

export function TrendLine({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const motion = useChartMotion();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} {...valueAxis(unit, data)} />
        <ChartTooltip unit={unit} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
          {...motion}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const motion = useChartMotion();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={8} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} {...valueAxis(unit, data)} />
        <ChartTooltip unit={unit} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[5, 5, 0, 0]} maxBarSize={36} {...motion} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars, for categories with longer names. */
export function RankedBars({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const motion = useChartMotion();
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} horizontal={false} />
        <XAxis
          type="number"
          tick={axis}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={axisFormatter(unit, data)}
        />
        <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} width={124} />
        <ChartTooltip unit={unit} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} {...motion} />
      </BarChart>
    </ResponsiveContainer>
  );
}
