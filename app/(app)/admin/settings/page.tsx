import type { Metadata } from "next";
import Link from "next/link";
import { PageBoundary } from "@/components/app/page-boundary";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { DemoDataPanel, type DemoSummary } from "@/components/settings/demo-data-panel";
import { LabelsForm } from "@/components/settings/labels-form";
import { LookupManager } from "@/components/settings/lookup-manager";
import {
  AttendanceSettingsForm,
  FinanceSettingsForm,
  GeneralSettingsForm,
  MembershipSettingsForm,
} from "@/components/settings/settings-forms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import { getChurchSettings, getLookup } from "@/lib/data/common";
import { supabaseUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

async function SettingsContent() {
  const access = await requireAccess();
  const canSettings = can(access, P.settingsManage);
  const canAppearance = can(access, P.appearanceManage);
  const canStages = can(access, P.settingsManage, P.discipleshipManage);
  const canMinistries = can(access, P.ministriesManage);
  const canFinance = canSettings || can(access, "finance.manage");
  const isSuperAdmin = access.roles.some((role) => role.key === "super_admin");
  if (!canSettings && !canAppearance && !canStages && !canMinistries && !canFinance) {
    return <NoAccess />;
  }

  const all = { includeInactive: true };
  const [settings, branding, membershipStatuses, baptismStatuses, attendanceTypes, attendanceStatuses, stages, ministries, givingCategories, expenseCategories] =
    await Promise.all([
      getChurchSettings(),
      getBranding(),
      canSettings ? getLookup("membership_statuses", all) : [],
      canSettings ? getLookup("baptism_statuses", all) : [],
      canSettings ? getLookup("attendance_types", all) : [],
      canSettings ? getLookup("attendance_statuses", all) : [],
      canStages ? getLookup("discipleship_stages", all) : [],
      canMinistries ? getLookup("ministries", all) : [],
      canFinance ? getLookup("giving_categories", all) : [],
      canFinance ? getLookup("expense_categories", all) : [],
    ]);
  const demoSummary = isSuperAdmin
    ? (((await (await createClient()).rpc("demo_data_summary")).data ?? null) as DemoSummary | null)
    : null;

  return (
    <>
      <PageHeader title="Settings" description="Configure the system without touching code." />
      <Tabs defaultValue={canSettings ? "general" : canAppearance ? "appearance" : canStages ? "discipleship" : canMinistries ? "ministries" : "finance"}>
        <div className="overflow-x-auto pb-1">
          <TabsList>
            {canSettings ? <TabsTrigger value="general">General</TabsTrigger> : null}
            {canAppearance ? <TabsTrigger value="appearance">Branding &amp; Appearance</TabsTrigger> : null}
            {canAppearance ? <TabsTrigger value="labels">Labels</TabsTrigger> : null}
            {canSettings ? <TabsTrigger value="membership">Membership</TabsTrigger> : null}
            {canSettings ? <TabsTrigger value="attendance">Attendance</TabsTrigger> : null}
            {canStages ? <TabsTrigger value="discipleship">Discipleship</TabsTrigger> : null}
            {canMinistries ? <TabsTrigger value="ministries">Ministries</TabsTrigger> : null}
            {canFinance ? <TabsTrigger value="finance">Finance</TabsTrigger> : null}
            {demoSummary ? <TabsTrigger value="system">System</TabsTrigger> : null}
          </TabsList>
        </div>

        {canSettings ? (
          <TabsContent value="general">
            <GeneralSettingsForm settings={settings} />
          </TabsContent>
        ) : null}

        {canAppearance ? (
          <TabsContent value="appearance">
            <AppearanceForm
              key={branding.updated_at ?? "initial"}
              branding={branding}
              assetBaseUrl={`${supabaseUrl}/storage/v1/object/public/branding`}
            />
          </TabsContent>
        ) : null}

        {canAppearance ? (
          <TabsContent value="labels">
            <LabelsForm key={branding.updated_at ?? "initial"} labels={branding.ui_labels} />
          </TabsContent>
        ) : null}

        {canSettings ? (
          <TabsContent value="membership" className="space-y-4">
            <MembershipSettingsForm settings={settings} />
            <LookupManager
              table="membership_statuses"
              title="Membership statuses"
              description="The choices for a member's membership status. The default is pre-selected for new members."
              noun="Membership status"
              items={membershipStatuses}
              hasDefault
            />
            <LookupManager
              table="baptism_statuses"
              title="Baptism statuses"
              description="The choices for a member's baptism status."
              noun="Baptism status"
              items={baptismStatuses}
              hasDefault
            />
          </TabsContent>
        ) : null}

        {canSettings ? (
          <TabsContent value="attendance" className="space-y-4">
            <AttendanceSettingsForm settings={settings} />
            <LookupManager
              table="attendance_types"
              title="Attendance types"
              description="The kinds of services and events attendance is recorded for."
              noun="Attendance type"
              items={attendanceTypes}
              flag={{
                key: "counts_for_absence",
                label: "Counts toward absences",
                hint: "Missing these services counts toward the absence threshold and feeds the dashboard's attendance trend.",
              }}
            />
            <LookupManager
              table="attendance_statuses"
              title="Attendance statuses"
              description="The marks that can be given when recording attendance."
              noun="Attendance status"
              items={attendanceStatuses}
              flag={{
                key: "counts_as_present",
                label: "Counts as present",
                hint: "Marks without this count as an absence in rates and statistics.",
              }}
            />
          </TabsContent>
        ) : null}

        {canStages ? (
          <TabsContent value="discipleship">
            <LookupManager
              table="discipleship_stages"
              title="Discipleship stages"
              description="The growth path, in order. Reorder with the arrows; switch a stage off to retire it without losing history."
              noun="Stage"
              items={stages}
              hasDescription
            />
          </TabsContent>
        ) : null}

        {canMinistries ? (
          <TabsContent value="ministries">
            <LookupManager
              table="ministries"
              title="Ministries"
              description="The ministries members can serve in. Leaders and member assignments are managed on the Ministries page."
              noun="Ministry"
              items={ministries}
              hasDescription
              removeVerb="Archive"
            />
          </TabsContent>
        ) : null}

        {canFinance ? (
          <TabsContent value="finance" className="space-y-4">
            {canSettings ? <FinanceSettingsForm settings={settings} /> : null}
            <p className="rounded-xl border bg-card p-4 text-sm shadow-xs">
              Payment methods and financial accounts are managed under{" "}
              <Link href="/finance/settings" className="text-link hover:underline">
                Finance → Settings
              </Link>
              .
            </p>
            <LookupManager
              table="giving_categories"
              title="Giving categories"
              description="The kinds of giving that can be recorded. A category that has records can be switched off but not deleted."
              noun="Giving category"
              items={givingCategories}
            />
            <LookupManager
              table="expense_categories"
              title="Expense categories"
              description="The kinds of expense that can be recorded."
              noun="Expense category"
              items={expenseCategories}
            />
          </TabsContent>
        ) : null}

        {demoSummary ? (
          <TabsContent value="system">
            <DemoDataPanel summary={demoSummary} />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Settings" description="Configure the system without touching code." variant="form" />}>
      <SettingsContent />
    </PageBoundary>
  );
}
