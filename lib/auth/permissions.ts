/**
 * Permission keys. The database is the source of truth (see the `permissions`
 * table and RLS policies); these constants only keep the UI in step with it.
 * UI checks decide what to show. They never decide what is allowed.
 */
export const P = {
  membersView: "members.view",
  membersViewAssigned: "members.view_assigned",
  membersCreate: "members.create",
  membersUpdate: "members.update",
  membersArchive: "members.archive",
  visitorsView: "visitors.view",
  visitorsCreate: "visitors.create",
  visitorsUpdate: "visitors.update",
  attendanceView: "attendance.view",
  attendanceViewAssigned: "attendance.view_assigned",
  attendanceCreate: "attendance.create",
  attendanceUpdate: "attendance.update",
  attendanceManageAssigned: "attendance.manage_assigned",
  groupsView: "groups.view",
  groupsManage: "groups.manage",
  careView: "care.view",
  discipleshipView: "discipleship.view",
  discipleshipManage: "discipleship.manage",
  ministriesView: "ministries.view",
  ministriesManage: "ministries.manage",
  eventsView: "events.view",
  financeView: "finance.view",
  reportsView: "reports.view",
  reportsExport: "reports.export",
  usersManage: "users.manage",
  rolesManage: "roles.manage",
  logsView: "logs.view",
  settingsManage: "settings.manage",
  appearanceManage: "appearance.manage",
} as const;

export type Access = {
  userId: string;
  email: string;
  fullName: string;
  themePreference: "light" | "dark" | "system" | null;
  roles: { key: string; name: string }[];
  permissions: string[];
  /** The `people` row linked to this login, if any. */
  personId: string | null;
};

export function can(access: Pick<Access, "permissions">, ...keys: string[]) {
  return keys.some((key) => access.permissions.includes(key));
}

/** Where a user lands after signing in. */
export function homePathFor(access: Pick<Access, "permissions">) {
  const seesDashboard = can(
    access,
    P.membersView,
    P.membersViewAssigned,
    P.visitorsView,
    P.attendanceView,
    P.attendanceViewAssigned,
  );
  return seesDashboard ? "/dashboard" : "/profile";
}
