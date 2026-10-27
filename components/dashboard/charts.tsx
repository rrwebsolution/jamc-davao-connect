"use client";

import { useSyncExternalStore } from "react";
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
function useChartMotion() {
  const allowed = useSyncExternalStore(
    never,
    () => document.documentElement.dataset.motion !== "off" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  return { isAnimationActive: allowed, animationDuration: 500, animationEasing: "ease-out" as const };
}

// Every dashboard chart shows one measure, so each uses a single series in
// the brand colour and is named by its card title rather than a legend.
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px rgb(0 0 0 / 0.08)",
};

// Peso charts label their value axis compactly (₱1.5K) so long amounts fit
// beside the bars; the tooltip shows the exact amount.
const PESOS = "pesos";
const compactPesos = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 2,
});

function valueAxis(unit: string) {
  return unit === PESOS ? { tickFormatter: (value: number) => compactPesos.format(value), width: 64 } : { width: 48 };
}

function ChartTooltip({ unit }: { unit: string }) {
  return (
    <Tooltip
      cursor={{ stroke: "var(--border)", fill: "var(--muted)", fillOpacity: 0.5 }}
      contentStyle={tooltipStyle}
      labelStyle={{ fontWeight: 600, marginBottom: 2 }}
      itemStyle={{ color: "var(--popover-foreground)" }}
      labelFormatter={(label, payload) => payload?.[0]?.payload?.detail ?? label}
      formatter={(value) => [unit === PESOS ? money(Number(value)) : `${value} ${unit}`, ""]}
      separator=""
    />
  );
}

export function TrendLine({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const motion = useChartMotion();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} {...valueAxis(unit)} />
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
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={8} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} {...valueAxis(unit)} />
        <ChartTooltip unit={unit} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
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
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={axis}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={unit === PESOS ? (value: number) => compactPesos.format(value) : undefined}
        />
        <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} width={124} />
        <ChartTooltip unit={unit} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} {...motion} />
      </BarChart>
    </ResponsiveContainer>
  );
}
