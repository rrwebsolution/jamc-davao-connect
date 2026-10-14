import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { UserManager, type MemberOption, type RoleOption, type UserRow } from "@/components/admin/user-manager";
import { LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings } from "@/lib/data/common";
import { describeError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

const DESCRIPTION = "Members who can sign in, and the roles their accounts hold.";

async function UsersContent() {
  const access = await requireAccess();
  if (!can(access, P.usersManage)) {
    return <NoAccess />;
  }

  const supabase = await createClient();
  const [accounts, roles, members, assignable, settings] = await Promise.all([
    // One row per login, with its member, roles and last sign-in.
    supabase.rpc("account_directory").order("display_name").order("email"),
    supabase.from("roles").select("id, key, name").order("name"),
    // Members to choose from when creating an account: the account always belongs to one.
    supabase
      .from("people_directory")
      .select("id, full_name, member_code, cell_group_name, email, user_id")
      .eq("person_type", "member")
      .is("archived_at", null)
      .order("full_name")
      .limit(2000),
    // Which roles this admin may hand out (the database enforces the same rule).
    supabase.rpc("assignable_roles"),
    getChurchSettings(),
  ]);
  if (accounts.error || roles.error) {
    console.error("Failed to load users", describeError(accounts.error ?? roles.error));
    return <LoadError what="the users" />;
  }

  type Account = {
    user_id: string;
    email: string;
    display_name: string;
    is_active: boolean;
    approval_status: UserRow["approval_status"];
    account_status: UserRow["account_status"];
    last_sign_in_at: string | null;
    person_id: string | null;
    person_name: string | null;
    member_code: string | null;
    role_ids: string[];
  };
  const users: UserRow[] = ((accounts.data ?? []) as Account[]).map((account) => ({
    id: account.user_id,
    email: account.email,
    name: account.display_name,
    is_active: account.is_active,
    approval_status: account.approval_status,
    account_status: account.account_status,
    roleIds: account.role_ids,
    personId: account.person_id,
    personName: account.person_name,
    memberCode: account.member_code,
    lastLogin: account.last_sign_in_at ? formatDateTime(account.last_sign_in_at, settings.timezone) : null,
  }));
  const memberOptions: MemberOption[] = (members.data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name,
    detail: [row.cell_group_name ?? "No cell group", row.member_code].filter(Boolean).join(" · "),
    email: row.email,
    userId: row.user_id,
  }));

  return (
    <>
      <PageHeader title="Users" description={DESCRIPTION} />
      <UserManager
        users={users}
        roles={(roles.data ?? []) as RoleOption[]}
        members={memberOptions}
        currentUserId={access.userId}
        assignableRoleIds={((assignable.data ?? []) as { id: string }[]).map((role) => role.id)}
        adminReady={isAdminConfigured}
      />
    </>
  );
}

export default function UsersPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Users" description={DESCRIPTION} />}>
      <UsersContent />
    </PageBoundary>
  );
}
