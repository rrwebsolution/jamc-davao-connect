import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { RoleManager, type PermissionRow, type RoleRow } from "@/components/admin/role-manager";
import { LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Roles & Permissions" };

// Shown first, in order of how much they can do; custom roles follow by name.
const SYSTEM_ORDER = ["super_admin", "pastor", "cell_leader", "member"];

async function RolesContent() {
  const access = await requireAccess();
  if (!can(access, P.rolesManage)) {
    return <NoAccess />;
  }

  const supabase = await createClient();
  const [roles, permissions, rolePermissions, userRoles] = await Promise.all([
    supabase.from("roles").select("id, key, name, description, is_system").order("name"),
    supabase.from("permissions").select("id, key, module, description").order("sort_order"),
    supabase.from("role_permissions").select("role_id, permission_id"),
    supabase.from("user_roles").select("role_id"),
  ]);
  if (roles.error || permissions.error) {
    console.error("Failed to load roles", describeError(roles.error ?? permissions.error));
    return <LoadError what="the roles" />;
  }

  const rank = (key: string) => (SYSTEM_ORDER.includes(key) ? SYSTEM_ORDER.indexOf(key) : SYSTEM_ORDER.length);
  const rows: RoleRow[] = (roles.data ?? [])
    .map((role) => ({
      ...role,
      userCount: (userRoles.data ?? []).filter((row) => row.role_id === role.id).length,
      permissionIds: (rolePermissions.data ?? [])
        .filter((row) => row.role_id === role.id)
        .map((row) => row.permission_id as string),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="What each role can see and do. Changes apply the next time a user loads a page, and are enforced by the database."
      />
      <RoleManager roles={rows} permissions={(permissions.data ?? []) as PermissionRow[]} />
    </>
  );
}

export default function RolesPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Roles & Permissions" />}>
      <RolesContent />
    </PageBoundary>
  );
}