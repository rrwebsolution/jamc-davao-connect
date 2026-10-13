const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DATE_FORMATS = [
  { value: "MMM d, yyyy", label: "Jan 5, 2026" },
  { value: "MM/dd/yyyy", label: "01/05/2026" },
  { value: "dd/MM/yyyy", label: "05/01/2026" },
  { value: "yyyy-MM-dd", label: "2026-01-05" },
] as const;

/**
 * Formats a Postgres `date` ("2026-01-05") without going through a Date
 * object, so the day never shifts with the viewer's timezone.
 */
export function formatDate(value: string | null | undefined, format = "MMM d, yyyy") {
  if (!value) {
    return "—";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) {
    return value;
  }
  switch (format) {
    case "MM/dd/yyyy":
      return `${month}/${day}/${year}`;
    case "dd/MM/yyyy":
      return `${day}/${month}/${year}`;
    case "yyyy-MM-dd":
      return `${year}-${month}-${day}`;
    default:
      return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
  }
}

/** Formats a timestamp in the church's timezone. */
export function formatDateTime(value: string | null | undefined, timeZone = "Asia/Manila") {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-PH", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatMonth(value: string) {
  const [year, month] = value.slice(0, 10).split("-");
  return `${MONTHS[Number(month) - 1]} ${year.slice(2)}`;
}

export function formatDayMonth(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function ageFrom(birthdate: string | null, today: string) {
  if (!birthdate) {
    return null;
  }
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Percentage change between two periods, or null when there is no baseline. */
export function percentChange(current: number, previous: number) {
  if (!previous) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 100);
}
