"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import type { ZodTypeAny } from "zod";
import {
  saveAttendanceSettings,
  saveGeneralSettings,
  saveMembershipSettings,
  setTrackIndividualGiving,
} from "@/app/(app)/admin/settings/actions";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, NativeSelect, PendingButton } from "@/components/shared/form";
import { DATE_FORMATS } from "@/lib/format";
import type { ActionResult, ChurchSettings } from "@/lib/types";
import { attendanceSettingsSchema, generalSettingsSchema, membershipSettingsSchema } from "@/lib/validation";

function useSettingsForm(schema: ZodTypeAny, defaultValues: FieldValues, save: (input: unknown) => Promise<ActionResult>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FieldValues>,
    defaultValues,
  });
  const onSubmit = form.handleSubmit(() => {
    const values = form.getValues();
    startTransition(async () => {
      const result = await save(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Settings saved");
      form.reset(values);
      router.refresh();
    });
  });
  const error = (name: string) => form.formState.errors[name]?.message as string | undefined;
  return { form, onSubmit, pending, error };
}

function SaveBar({ pending, dirty }: { pending: boolean; dirty: boolean }) {
  return (
    <div className="mt-5 flex justify-end">
      <PendingButton type="submit" pending={pending} pendingText="Saving…" disabled={!dirty}>
        Save changes
      </PendingButton>
    </div>
  );
}

export function GeneralSettingsForm({ settings }: { settings: ChurchSettings }) {
  const { form, onSubmit, pending, error } = useSettingsForm(
    generalSettingsSchema,
    {
      church_name: settings.church_name,
      church_address: settings.church_address ?? "",
      contact_number: settings.contact_number ?? "",
      email: settings.email ?? "",
      timezone: settings.timezone,
      date_format: settings.date_format,
      rows_per_page: String(settings.rows_per_page),
    },
    saveGeneralSettings,
  );
  const { register } = form;

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormSection title="Church details" description="Shown on the login page, the dashboard and reports.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Church name" htmlFor="church_name" required error={error("church_name")}>
            <Input id="church_name" {...register("church_name")} />
          </Field>
          <Field label="Contact number" htmlFor="contact_number" error={error("contact_number")}>
            <Input id="contact_number" type="tel" {...register("contact_number")} />
          </Field>
          <Field label="Email" htmlFor="email" error={error("email")}>
            <Input id="email" type="email" {...register("email")} />
          </Field>
          <Field label="Timezone" htmlFor="timezone" error={error("timezone")} hint="IANA name. “Today” and all dates follow it.">
            <Input id="timezone" placeholder="Asia/Manila" {...register("timezone")} />
          </Field>
          <Field label="Date format" htmlFor="date_format" error={error("date_format")}>
            <NativeSelect id="date_format" {...register("date_format")}>
              {DATE_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Rows per page"
            htmlFor="rows_per_page"
            error={error("rows_per_page")}
            hint="How many rows every list shows before the next page: Members, Visitors, Attendance, Follow-ups, Finance, Activity Logs and the rest."
          >
            <NativeSelect id="rows_per_page" {...register("rows_per_page")}>
              {[10, 20, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Church address" htmlFor="church_address" error={error("church_address")} className="sm:col-span-2">
            <Textarea id="church_address" rows={2} {...register("church_address")} />
          </Field>
        </div>
        <SaveBar pending={pending} dirty={form.formState.isDirty} />
      </FormSection>
    </form>
  );
}

export function MembershipSettingsForm({ settings }: { settings: ChurchSettings }) {
  const { form, onSubmit, pending, error } = useSettingsForm(
    membershipSettingsSchema,
    { member_id_prefix: settings.member_id_prefix, member_id_padding: settings.member_id_padding },
    saveMembershipSettings,
  );
  const prefix = String(form.watch("member_id_prefix") ?? "");
  const padding = Math.min(10, Math.max(3, Number(form.watch("member_id_padding")) || 5));

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormSection
        title="Member ID format"
        description="Applied to members added from now on. Existing member IDs are never changed."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Prefix" htmlFor="member_id_prefix" error={error("member_id_prefix")}>
            <Input id="member_id_prefix" maxLength={12} {...form.register("member_id_prefix")} />
          </Field>
          <Field label="Number of digits" htmlFor="member_id_padding" error={error("member_id_padding")}>
            <Input id="member_id_padding" type="number" min={3} max={10} {...form.register("member_id_padding")} />
          </Field>
          <Field label="Example">
            <p className="flex h-8 items-center font-mono text-sm">
              {prefix}
              {"1".padStart(padding, "0")}
            </p>
          </Field>
        </div>
        <SaveBar pending={pending} dirty={form.formState.isDirty} />
      </FormSection>
    </form>
  );
}

export function AttendanceSettingsForm({ settings }: { settings: ChurchSettings }) {
  const { form, onSubmit, pending, error } = useSettingsForm(
    attendanceSettingsSchema,
    { absence_threshold: settings.absence_threshold },
    saveAttendanceSettings,
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormSection
        title="Absence follow-up threshold"
        description="A member is flagged after this many consecutive absences from services that count toward the threshold (see Attendance types below)."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Consecutive absences"
            htmlFor="absence_threshold"
            error={error("absence_threshold")}
            hint="When a member reaches it, an absentee follow-up is created for their cell leader and the care team is notified."
          >
            <Input id="absence_threshold" type="number" min={1} max={52} {...form.register("absence_threshold")} />
          </Field>
        </div>
        <SaveBar pending={pending} dirty={form.formState.isDirty} />
      </FormSection>
    </form>
  );
}

export function FinanceSettingsForm({ settings }: { settings: ChurchSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <FormSection
      title="Individual giving"
      description="By default giving is recorded without a name. Turn this on only if the church has decided to track who gave."
    >
      <label className="flex items-start gap-3 text-sm">
        <Switch
          checked={settings.track_individual_giving}
          disabled={pending}
          onCheckedChange={(checked) =>
            startTransition(async () => {
              const result = await setTrackIndividualGiving(checked);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(checked ? "Individual giving tracking is on" : "Individual giving tracking is off");
              router.refresh();
            })
          }
        />
        <span>
          Track individual giving
          <span className="block text-xs text-muted-foreground">
            When on, a giving record can optionally be linked to a member. It is never required, and existing links are kept if you turn it off.
          </span>
        </span>
      </label>
    </FormSection>
  );
}
