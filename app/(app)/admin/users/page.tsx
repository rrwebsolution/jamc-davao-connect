import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { UserManager, type RoleOption, type UserRow } from "@/components/admin/user-manager";
import { LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Users" };

async function UsersContent() {
  const access = await requireAccess();
  if (!can(access, P.usersManage)) {
    return <NoAccess />;
  }

  const supabase = await createClient();
  const [profiles, roles, userRoles, linked, unlinked] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, is_active").order("full_name").order("email"),
    supabase.from("roles").select("id, key, name").order("name"),
    supabase.from("user_roles").select("user_id, role_id"),
    supabase.from("people").select("user_id, full_name").not("user_id", "is", null),
    supabase
      .from("people")
      .select("id, full_name")
      .eq("person_type", "member")
      .is("user_id", null)
      .is("archived_at", null)
      .order("full_name")
      .limit(1000),
  ]);
  if (profiles.error || roles.error) {
    console.error("Failed to load users", describeError(profiles.error ?? roles.error));
    return <LoadError what="the users" />;
  }

  const personByUser = new Map((linked.data ?? []).map((row) => [row.user_id as string, row.full_name as string]));
  const users: UserRow[] = (profiles.data ?? []).map((profile) => ({
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    is_active: profile.is_active,
    roleIds: (userRoles.data ?? []).filter((row) => row.user_id === profile.id).map((row) => row.role_id as string),
    personName: personByUser.get(profile.id) ?? null,
  }));

  return (
    <>
      <PageHeader title="Users" description="People who can sign in, and the roles they hold." />
      <UserManager
        users={users}
        roles={(roles.data ?? []) as RoleOption[]}
        people={(unlinked.data ?? []).map((row) => ({ id: row.id, name: row.full_name }))}
        currentUserId={access.userId}
        isSuperAdmin={access.roles.some((role) => role.key === "super_admin")}
        adminReady={isAdminConfigured}
      />
    </>
  );
}

export default function UsersPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Users" description="People who can sign in, and the roles they hold." />}>
      <UsersContent />
    </PageBoundary>
  );
}