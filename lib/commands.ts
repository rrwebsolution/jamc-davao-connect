import {
  ArrowRightLeft,
  CalendarPlus,
  ClipboardCheck,
  HandCoins,
  HandHeart,
  HeartHandshake,
  Receipt,
  UserPlus,
  UserRound,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { P } from "@/lib/auth/permissions";

export type QuickAction = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds any of these. Empty = every signed-in user. */
  permissions: string[];
  keywords: string[];
};

// `?new=1` opens the page's own create dialog, so the action lands on the
// real page (and goes through its permission checks) rather than a copy.
export const QUICK_ACTIONS: QuickAction[] = [
  { title: "Add Member", href: "/people/members/new", icon: UserRoundPlus, permissions: [P.membersCreate], keywords: ["new", "create", "member", "people"] },
  { title: "Add Visitor", href: "/people/visitors/new", icon: UserPlus, permissions: [P.visitorsCreate], keywords: ["new", "register", "visitor", "guest"] },
  { title: "Record Attendance", href: "/attendance/services?new=1", icon: ClipboardCheck, permissions: [P.attendanceCreate, P.attendanceManageAssigned], keywords: ["new", "session", "service", "attendance", "check in"] },
  { title: "Create Cell Group", href: "/groups?new=1", icon: UsersRound, permissions: [P.groupsManage], keywords: ["new", "cell", "group"] },
  { title: "Create Follow-up", href: "/care/follow-ups?new=1", icon: HeartHandshake, permissions: ["care.manage", "care.manage_assigned"], keywords: ["new", "follow", "call", "visit", "care"] },
  { title: "Add Care Record", href: "/care/pastoral?new=1", icon: HandHeart, permissions: ["care.manage"], keywords: ["new", "pastoral", "counseling", "care"] },
  { title: "Add Event", href: "/events?new=1", icon: CalendarPlus, permissions: ["events.manage"], keywords: ["new", "create", "event", "activity"] },
  { title: "Record Giving", href: "/finance/giving?new=1", icon: HandCoins, permissions: ["finance.manage"], keywords: ["new", "tithe", "offering", "giving", "finance"] },
  { title: "Record Expense", href: "/finance/expenses?new=1", icon: Receipt, permissions: ["finance.manage"], keywords: ["new", "expense", "payment", "finance"] },
  { title: "Record Transfer", href: "/finance/transfers?new=1", icon: ArrowRightLeft, permissions: ["finance.manage"], keywords: ["new", "transfer", "deposit", "move", "finance"] },
  { title: "My Profile", href: "/profile", icon: UserRound, permissions: [], keywords: ["account", "password", "profile"] },
];

/** Extra words that should find a page, beyond its name and section. */
export const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/people/members": ["people", "directory"],
  "/people/visitors": ["guests", "first timers"],
  "/attendance/services": ["attendance", "sessions", "sunday"],
  "/attendance/records": ["attendance"],
  "/attendance/history": ["attendance", "absences"],
  "/groups": ["cell", "small group", "group attendance"],
  "/care/follow-ups": ["follow", "care", "tasks"],
  "/care/pastoral": ["pastoral", "counseling", "care"],
  "/discipleship": ["growth", "stages", "mentors"],
  "/finance": ["giving", "expenses", "money", "tithes"],
  "/reports": ["export", "print"],
  "/admin/users": ["accounts", "logins"],
  "/admin/roles": ["permissions", "access"],
  "/admin/activity-logs": ["audit", "history"],
  "/admin/settings": ["branding", "appearance", "theme", "configuration"],
};
