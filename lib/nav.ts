import {
  Activity,
  BarChart3,
  Cake,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  HandHeart,
  HeartHandshake,
  History,
  LayoutDashboard,
  Network,
  PiggyBank,
  ScrollText,
  Settings,
  ShieldCheck,
  Sprout,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { P } from "@/lib/auth/permissions";

export type NavItem = {
  title: string;
  icon: LucideIcon;
  href: string;
  /** Shown when the user holds any of these. Empty = every signed-in user. */
  permissions: string[];
};

export type NavSection = { label: string | null; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: null,
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permissions: [P.membersView, P.membersViewAssigned, P.visitorsView, P.attendanceView, P.attendanceViewAssigned],
      },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Members", href: "/people/members", icon: Users, permissions: [P.membersView, P.membersViewAssigned] },
      { title: "Visitors", href: "/people/visitors", icon: UserPlus, permissions: [P.visitorsView] },
      { title: "Birthdays", href: "/people/birthdays", icon: Cake, permissions: [P.membersView, P.membersViewAssigned] },
    ],
  },
  {
    label: "Attendance",
    items: [
      { title: "Services", href: "/attendance/services", icon: CalendarCheck, permissions: [P.attendanceView, P.attendanceViewAssigned] },
      { title: "Attendance Records", href: "/attendance/records", icon: ClipboardList, permissions: [P.attendanceView, P.attendanceViewAssigned] },
      { title: "Attendance History", href: "/attendance/history", icon: History, permissions: [P.attendanceView, P.attendanceViewAssigned] },
    ],
  },
  {
    label: "Groups",
    items: [
      // Members see their own group, so this is open to every signed-in user; RLS scopes the list.
      { title: "Cell Groups", href: "/groups", icon: UsersRound, permissions: [] },
    ],
  },
  {
    label: "Care",
    items: [
      // Anyone can be assigned a follow-up; RLS returns only what they may see.
      { title: "Follow-ups", href: "/care/follow-ups", icon: HeartHandshake, permissions: [] },
      { title: "Pastoral Care", href: "/care/pastoral", icon: HandHeart, permissions: ["care.view", "care.manage", "care.confidential"] },
    ],
  },
  {
    label: "Growth",
    items: [
      { title: "Discipleship", href: "/discipleship", icon: Sprout, permissions: [P.discipleshipView, "discipleship.view_assigned"] },
      { title: "Ministries", href: "/ministries", icon: Network, permissions: [P.ministriesView, P.ministriesManage] },
      { title: "Events", href: "/events", icon: CalendarDays, permissions: [P.eventsView, "events.manage"] },
    ],
  },
  {
    label: "Finance & Reports",
    items: [
      { title: "Finance", href: "/finance", icon: PiggyBank, permissions: [P.financeView] },
      { title: "Reports", href: "/reports", icon: BarChart3, permissions: [P.reportsView] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users", href: "/admin/users", icon: UserCog, permissions: [P.usersManage] },
      { title: "Roles & Permissions", href: "/admin/roles", icon: ShieldCheck, permissions: [P.rolesManage] },
      { title: "Activity Logs", href: "/admin/activity-logs", icon: ScrollText, permissions: [P.logsView] },
      { title: "Settings", href: "/admin/settings", icon: Settings, permissions: [P.settingsManage, P.appearanceManage, P.discipleshipManage, P.ministriesManage, "finance.manage"] },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  people: "People",
  members: "Members",
  visitors: "Visitors",
  birthdays: "Birthdays",
  attendance: "Attendance",
  services: "Services",
  records: "Attendance Records",
  history: "Attendance History",
  admin: "Administration",
  users: "Users",
  roles: "Roles & Permissions",
  "activity-logs": "Activity Logs",
  settings: "Settings",
  profile: "My Profile",
  groups: "Cell Groups",
  care: "Care",
  "follow-ups": "Follow-ups",
  pastoral: "Pastoral Care",
  discipleship: "Discipleship",
  ministries: "Ministries",
  events: "Events",
  finance: "Finance",
  giving: "Giving",
  expenses: "Expenses",
  transfers: "Transfers",
  reports: "Reports",
  new: "New",
  edit: "Edit",
};

export const ActivityIcon = Activity;
