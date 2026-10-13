import { StatusPill } from "@/components/shared/person-avatar";
import { VISITOR_STATUSES, type VisitorStatus } from "@/lib/types";

const TONES: Record<VisitorStatus, "neutral" | "success" | "warning" | "brand"> = {
  new: "warning",
  contacted: "neutral",
  follow_up_scheduled: "brand",
  returning: "success",
  connected_to_cell_group: "success",
  became_member: "success",
};

export function VisitorStatusPill({ status }: { status: VisitorStatus | null }) {
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = VISITOR_STATUSES.find((item) => item.value === status)?.label ?? status;
  return <StatusPill tone={TONES[status]}>{label}</StatusPill>;
}
