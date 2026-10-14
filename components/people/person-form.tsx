"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldValues, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { createMemberAccount } from "@/app/(app)/admin/actions";
import { saveMember, saveVisitor } from "@/app/(app)/people/actions";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, NativeSelect, PendingButton } from "@/components/shared/form";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { createClient } from "@/lib/supabase/client";
import { CIVIL_STATUSES, GENDERS, VISITOR_STATUSES, type Lookup, type Person } from "@/lib/types";
import { memberSchema, visitorSchema } from "@/lib/validation";

type Option = { id: string; name: string };

export type PersonFormOptions = {
  membershipStatuses: Lookup[];
  baptismStatuses: Lookup[];
  stages: Lookup[];
  ministries: Lookup[];
  attendanceTypes: Lookup[];
  cellGroups: Option[];
  /** Current members: mentor choices for a member, "invited by" choices for a visitor. */
  mentors: Option[];
};

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function defaults(mode: "member" | "visitor", person: Person | null, options: PersonFormOptions, today: string) {
  const base = {
    first_name: person?.first_name ?? "",
    middle_name: person?.middle_name ?? "",
    last_name: person?.last_name ?? "",
    nickname: person?.nickname ?? "",
    gender: person?.gender ?? "",
    birthdate: person?.birthdate ?? "",
    civil_status: person?.civil_status ?? "",
    contact_number: person?.contact_number ?? "",
    email: person?.email ?? "",
    address: person?.address ?? "",
    photo_path: person?.photo_path ?? "",
  };
  if (mode === "visitor") {
    return {
      ...base,
      first_visit_date: person?.first_visit_date ?? today,
      // A member chosen from the list, or "other" for a name typed in by hand.
      invited_by_person_id: person?.invited_by_person_id ?? (person?.invited_by ? "other" : ""),
      invited_by_name: person?.invited_by_person_id ? "" : (person?.invited_by ?? ""),
      attendance_type_id: person?.visit_attendance_type_id ?? "",
      prayer_request: person?.prayer_request ?? "",
      notes: person?.visitor_notes ?? "",
      status: person?.visitor_status ?? "new",
    };
  }
  return {
    ...base,
    date_first_attended: person?.date_first_attended ?? "",
    membership_date: person?.membership_date ?? "",
    membership_status_id:
      person?.membership_status_id ?? options.membershipStatuses.find((status) => status.is_default)?.id ?? "",
    baptism_status_id:
      person?.baptism_status_id ?? options.baptismStatuses.find((status) => status.is_default)?.id ?? "",
    baptism_date: person?.baptism_date ?? "",
    discipleship_stage_id: person?.discipleship_stage_id ?? "",
    mentor_id: person?.mentor_id ?? "",
    cell_group_id: person?.cell_group_id ?? "",
    is_active: person?.is_active ?? true,
  };
}

export function PersonForm({
  mode,
  person,
  photoUrl,
  options,
  today,
  accountRoles = null,
}: {
  mode: "member" | "visitor";
  person: Person | null;
  photoUrl: string | null;
  options: PersonFormOptions;
  today: string;
  /** Roles the signed-in admin may assign. Null hides "System access" (editing, visitors, or no permission). */
  accountRoles?: { id: string; key: string; name: string }[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(photoUrl);
  const listHref = mode === "member" ? "/people/members" : "/people/visitors";

  // "Create a user account for this member". Off by default: most members never sign in.
  const [withAccount, setWithAccount] = useState(false);
  const [account, setAccount] = useState({
    email: "",
    role_id: accountRoles?.find((role) => role.key === "member")?.id ?? accountRoles?.[0]?.id ?? "",
    method: "invite",
    password: "",
  });
  const [accountError, setAccountError] = useState<string | null>(null);

  const form = useForm<FieldValues>({
    resolver: (mode === "member" ? zodResolver(memberSchema) : zodResolver(visitorSchema)) as unknown as Resolver<FieldValues>,
    defaultValues: defaults(mode, person, options, today),
  });
  const { register, formState, setValue, control } = form;
  const [firstName, lastName, isActive, invitedBy] = useWatch({ control, name: ["first_name", "last_name", "is_active", "invited_by_person_id"] });
  const error = (name: string) => formState.errors[name]?.message as string | undefined;

  // Object URL of a newly chosen photo, released when replaced and on unmount.
  const objectUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function showPhoto(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setPhotoFile(file);
    setPreview(objectUrl.current);
  }

  function onPhotoChosen(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      toast.error("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error("That image is larger than 2 MB.");
      return;
    }
    showPhoto(file);
  }

  function removePhoto() {
    showPhoto(null);
    setValue("photo_path", "", { shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((_, event) => {
    // handleSubmit hands back the parsed output; send the raw values so the
    // server validates exactly what the user typed.
    void event;
    const values = form.getValues();

    // Check the account details before saving anything.
    const wantsAccount = Boolean(accountRoles) && withAccount;
    const login = { ...account, email: (account.email || String(values.email ?? "")).trim() };
    if (wantsAccount) {
      const problem = !/^\S+@\S+\.\S+$/.test(login.email)
        ? "Enter a login email, or fill in the member's email above."
        : !login.role_id
          ? "Choose a role for the account."
          : login.method === "password" && login.password.length < 8
            ? "The temporary password needs at least 8 characters."
            : null;
      setAccountError(problem);
      if (problem) return;
    }

    startTransition(async () => {
      let photoPath: string = values.photo_path ?? "";
      if (photoFile) {
        const extension = photoFile.type === "image/png" ? "png" : photoFile.type === "image/webp" ? "webp" : "jpg";
        const path = `${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await createClient()
          .storage.from("people-photos")
          .upload(path, photoFile, { contentType: photoFile.type });
        if (uploadError) {
          toast.error("The photo could not be uploaded. Please try again.");
          return;
        }
        photoPath = path;
      }

      const payload = { ...values, photo_path: photoPath };
      const result =
        mode === "member" ? await saveMember(person?.id ?? null, payload) : await saveVisitor(person?.id ?? null, payload);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (wantsAccount) {
        // The member is saved. If the account fails it can be retried from the
        // profile, which creates only the account, never a second member.
        const created = await createMemberAccount(result.data!.id, login);
        if (!created.ok) {
          toast.warning("Member was created successfully, but the user account could not be created.", {
            description: `${created.error} You can retry from Account access.`,
            duration: 12000,
          });
          startNavigationProgress();
          router.push(`${listHref}/${result.data!.id}?account=new`);
          return;
        }
        toast.success(login.method === "invite" ? "Member added and invitation sent" : "Member added with a user account");
      } else {
        toast.success(person ? "Changes saved" : mode === "member" ? "Member added" : "Visitor registered");
      }
      startNavigationProgress();
      router.push(`${listHref}/${result.data!.id}`);
    });
  });

  const fullName = `${firstName ?? ""} ${lastName ?? ""}`.trim() || "New";

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormSection title="Personal information">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <PersonAvatar name={fullName} src={preview} className="size-20 text-lg" />
          <div className="flex flex-wrap gap-2">
            <label className={buttonVariants({ variant: "outline" }) + " cursor-pointer"}>
              <ImagePlus /> {preview ? "Replace photo" : "Add photo"}
              <input
                type="file"
                accept={PHOTO_TYPES.join(",")}
                className="sr-only"
                onChange={(event) => {
                  onPhotoChosen(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {preview ? (
              <Button type="button" variant="ghost" onClick={removePhoto}>
                <Trash2 /> Remove
              </Button>
            ) : null}
          </div>
          <p className="w-full text-xs text-muted-foreground">JPG, PNG or WebP, up to 2 MB.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" htmlFor="first_name" required error={error("first_name")}>
            <Input id="first_name" aria-invalid={Boolean(error("first_name"))} {...register("first_name")} />
          </Field>
          <Field label="Middle name" htmlFor="middle_name" error={error("middle_name")}>
            <Input id="middle_name" {...register("middle_name")} />
          </Field>
          <Field label="Last name" htmlFor="last_name" required error={error("last_name")}>
            <Input id="last_name" aria-invalid={Boolean(error("last_name"))} {...register("last_name")} />
          </Field>
          <Field label="Nickname" htmlFor="nickname" error={error("nickname")}>
            <Input id="nickname" {...register("nickname")} />
          </Field>
          <Field label="Gender" htmlFor="gender" error={error("gender")}>
            <NativeSelect id="gender" {...register("gender")}>
              <option value="">Not specified</option>
              {GENDERS.map((gender) => (
                <option key={gender.value} value={gender.value}>
                  {gender.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Birthdate" htmlFor="birthdate" error={error("birthdate")}>
            <Input id="birthdate" type="date" max={today} {...register("birthdate")} />
          </Field>
          <Field label="Civil status" htmlFor="civil_status" error={error("civil_status")}>
            <NativeSelect id="civil_status" {...register("civil_status")}>
              <option value="">Not specified</option>
              {CIVIL_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Contact number" htmlFor="contact_number" error={error("contact_number")}>
            <Input id="contact_number" type="tel" autoComplete="off" {...register("contact_number")} />
          </Field>
          <Field label="Email" htmlFor="email" error={error("email")}>
            <Input id="email" type="email" autoComplete="off" {...register("email")} />
          </Field>
          <Field label="Address" htmlFor="address" error={error("address")} className="sm:col-span-2 lg:col-span-3">
            <Textarea id="address" rows={2} {...register("address")} />
          </Field>
        </div>
      </FormSection>

      {mode === "member" ? (
        <FormSection title="Church information">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Date first attended" htmlFor="date_first_attended" error={error("date_first_attended")}>
              <Input id="date_first_attended" type="date" {...register("date_first_attended")} />
            </Field>
            <Field label="Membership date" htmlFor="membership_date" error={error("membership_date")}>
              <Input id="membership_date" type="date" {...register("membership_date")} />
            </Field>
            <Field label="Membership status" htmlFor="membership_status_id" error={error("membership_status_id")}>
              <NativeSelect id="membership_status_id" {...register("membership_status_id")}>
                <option value="">Not set</option>
                {options.membershipStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Baptism status" htmlFor="baptism_status_id" error={error("baptism_status_id")}>
              <NativeSelect id="baptism_status_id" {...register("baptism_status_id")}>
                <option value="">Not set</option>
                {options.baptismStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Baptism date" htmlFor="baptism_date" error={error("baptism_date")}>
              <Input id="baptism_date" type="date" {...register("baptism_date")} />
            </Field>
            <Field
              label="Cell group"
              htmlFor="cell_group_id"
              error={error("cell_group_id")}
              hint={options.cellGroups.length === 0 ? "No cell groups yet. Create them under Cell Groups." : undefined}
            >
              <NativeSelect id="cell_group_id" {...register("cell_group_id")}>
                <option value="">None</option>
                {options.cellGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Discipleship stage" htmlFor="discipleship_stage_id" error={error("discipleship_stage_id")}>
              <NativeSelect id="discipleship_stage_id" {...register("discipleship_stage_id")}>
                <option value="">Not set</option>
                {options.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Mentor" htmlFor="mentor_id" error={error("mentor_id")}>
              <NativeSelect id="mentor_id" {...register("mentor_id")}>
                <option value="">None</option>
                {options.mentors
                  .filter((mentor) => mentor.id !== person?.id)
                  .map((mentor) => (
                    <option key={mentor.id} value={mentor.id}>
                      {mentor.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <Switch
                id="is_active"
                checked={Boolean(isActive)}
                onCheckedChange={(checked) => setValue("is_active", checked, { shouldDirty: true })}
              />
              <label htmlFor="is_active" className="text-sm">
                Active member
              </label>
            </div>
          </div>
        </FormSection>
      ) : (
        <FormSection title="Visit details">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="First visit date" htmlFor="first_visit_date" required error={error("first_visit_date")}>
              <Input id="first_visit_date" type="date" {...register("first_visit_date")} />
            </Field>
            <Field label="Service attended" htmlFor="attendance_type_id" error={error("attendance_type_id")}>
              <NativeSelect id="attendance_type_id" {...register("attendance_type_id")}>
                <option value="">Not specified</option>
                {options.attendanceTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Invited by" htmlFor="invited_by_person_id" error={error("invited_by_person_id")}>
              <NativeSelect id="invited_by_person_id" {...register("invited_by_person_id")}>
                <option value="">No one / not known</option>
                {options.mentors
                  .filter((member) => member.id !== person?.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                <option value="other">Someone else (not a member)</option>
              </NativeSelect>
            </Field>
            {invitedBy === "other" ? (
              <Field label="Inviter's name" htmlFor="invited_by_name" error={error("invited_by_name")}>
                <Input id="invited_by_name" {...register("invited_by_name")} />
              </Field>
            ) : null}
            <Field label="Status" htmlFor="status" error={error("status")}>
              <NativeSelect id="status" {...register("status")}>
                {VISITOR_STATUSES.filter(
                  (status) => status.value !== "became_member" || person?.visitor_status === "became_member",
                ).map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prayer request" htmlFor="prayer_request" error={error("prayer_request")} className="sm:col-span-2 lg:col-span-3">
              <Textarea id="prayer_request" rows={3} {...register("prayer_request")} />
            </Field>
            <Field label="Notes" htmlFor="notes" error={error("notes")} className="sm:col-span-2 lg:col-span-3">
              <Textarea id="notes" rows={3} {...register("notes")} />
            </Field>
          </div>
        </FormSection>
      )}

      {accountRoles ? (
        <FormSection title="System access" description="Optional. A member can be in the church records without being able to sign in.">
          <label className="flex items-start gap-3 text-sm font-medium">
            <Checkbox checked={withAccount} onCheckedChange={(checked) => setWithAccount(Boolean(checked))} className="mt-0.5" />
            <span>
              Create a user account for this member
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                The account is approved straight away and linked to this member record.
              </span>
            </span>
          </label>
          {withAccount ? (
            <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Login email" htmlFor="account_email" hint="Leave empty to use the member's email above.">
                <Input
                  id="account_email"
                  type="email"
                  autoComplete="off"
                  value={account.email}
                  onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))}
                />
              </Field>
              <Field label="Role" htmlFor="account_role" required>
                <NativeSelect
                  id="account_role"
                  value={account.role_id}
                  onChange={(event) => setAccount((current) => ({ ...current, role_id: event.target.value }))}
                >
                  {accountRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="How they get their password" htmlFor="account_method">
                <NativeSelect
                  id="account_method"
                  value={account.method}
                  onChange={(event) => setAccount((current) => ({ ...current, method: event.target.value }))}
                >
                  <option value="invite">Send an invitation email</option>
                  <option value="password">I set a temporary password</option>
                </NativeSelect>
              </Field>
              {account.method === "password" ? (
                <Field label="Temporary password" htmlFor="account_password" required hint="At least 8 characters.">
                  <Input
                    id="account_password"
                    type="text"
                    autoComplete="off"
                    value={account.password}
                    onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))}
                  />
                </Field>
              ) : null}
              {accountError ? (
                <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">
                  {accountError}
                </p>
              ) : null}
            </div>
          ) : null}
        </FormSection>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={person ? `${listHref}/${person.id}` : listHref}
          className={buttonVariants({ variant: "outline" })}
        >
          Cancel
        </Link>
        <PendingButton type="submit" pending={pending} pendingText="Saving…">
          {person ? "Save changes" : mode === "member" ? "Add member" : "Register visitor"}
        </PendingButton>
      </div>
    </form>
  );
}
