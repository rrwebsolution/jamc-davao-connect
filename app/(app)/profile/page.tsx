import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { AttendanceSummary } from "@/components/attendance/attendance-summary";
import { PasswordForm } from "@/components/auth/auth-forms";
import { AccountNameForm, OwnContactForm } from "@/components/profile/profile-forms";
import { FormSection } from "@/components/shared/form";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { PageHeader, PageSkeleton } from "@/components/shared/states";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, signPhotoUrls } from "@/lib/data/common";
import { getPerson } from "@/lib/data/people";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "My Profile" };

async function ProfileContent() {
  const access = await requireAccess();
  const [person, settings] = await Promise.all([
    access.personId ? getPerson(access.personId) : null,
    getChurchSettings(),
  ]);
  const photos = await signPhotoUrls([person?.photo_path]);

  return (
    <>
      <PageHeader title="My Profile" />
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <PersonAvatar
            name={access.fullName}
            src={person?.photo_path ? photos[person.photo_path] : null}
            className="size-16 text-lg"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{access.fullName}</p>
            <p className="truncate text-sm text-muted-foreground">{access.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {access.roles.length === 0 ? <StatusPill tone="warning">No role assigned</StatusPill> : null}
              {access.roles.map((role) => (
                <StatusPill key={role.key} tone="brand">
                  {role.name}
                </StatusPill>
              ))}
            </div>
          </div>
        </div>

        {access.roles.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
            Your account doesn&apos;t have a role yet, so most of the system is hidden. Please ask an administrator to assign one.
          </p>
        ) : null}

        <FormSection title="Account">
          <AccountNameForm name={access.fullName} email={access.email} />
        </FormSection>

        {person ? (
          <>
            <FormSection title="My church record" description="Kept by the church office. Ask them to correct anything you can't change here.">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Member ID", person.member_code],
                  ["Membership status", person.membership_status_name],
                  ["Membership date", person.membership_date ? formatDate(person.membership_date, settings.date_format) : null],
                  ["Cell group", person.cell_group_name],
                  ["Cell leader", person.cell_leader_name],
                  ["Ministry", person.ministry_names.join(", ")],
                  ["Discipleship stage", person.discipleship_stage_name],
                  ["Mentor", person.mentor_name],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-sm">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </FormSection>

            <FormSection title="My contact details" description="You can keep these up to date yourself.">
              <OwnContactForm
                initial={{
                  nickname: person.nickname ?? "",
                  contact_number: person.contact_number ?? "",
                  email: person.email ?? "",
                  address: person.address ?? "",
                }}
              />
            </FormSection>

            <section>
              <h2 className="mb-3 text-base font-semibold">My attendance</h2>
              <AttendanceSummary personId={person.id} dateFormat={settings.date_format} threshold={settings.absence_threshold} />
            </section>
          </>
        ) : null}

        <div id="change-password" className="scroll-mt-20" />
        <FormSection title="Change password">
          <div className="max-w-sm">
            <PasswordForm />
          </div>
        </FormSection>
      </div>
    </>
  );
}

export default function ProfilePage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="My Profile" variant="form" />}>
      <ProfileContent />
    </PageBoundary>
  );
}
