"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateProfileName } from "@/app/(app)/admin/actions";
import { updateOwnContact } from "@/app/(app)/people/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, PendingButton } from "@/components/shared/form";
import type { ActionResult } from "@/lib/types";

function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const save = (action: () => Promise<ActionResult>, message: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      router.refresh();
    });
  return { pending, save };
}

export function AccountNameForm({ name, email }: { name: string; email: string }) {
  const [value, setValue] = useState(name);
  const { pending, save } = useSave();

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        save(() => updateProfileName({ full_name: value }), "Name updated");
      }}
    >
      <Field label="Display name" htmlFor="account_name" required>
        <Input id="account_name" required maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Sign-in email" htmlFor="account_email" hint="Ask an administrator to change this.">
        <Input id="account_email" value={email} disabled readOnly />
      </Field>
      <div className="sm:col-span-2">
        <PendingButton type="submit" pending={pending} pendingText="Saving…" disabled={!value.trim() || value.trim() === name}>
          Save name
        </PendingButton>
      </div>
    </form>
  );
}

type Contact = { nickname: string; contact_number: string; email: string; address: string };

export function OwnContactForm({ initial }: { initial: Contact }) {
  const [values, setValues] = useState(initial);
  const { pending, save } = useSave();
  const set = (key: keyof Contact) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        save(() => updateOwnContact(values), "Your details were updated");
      }}
    >
      <Field label="Nickname" htmlFor="own_nickname">
        <Input id="own_nickname" maxLength={80} value={values.nickname} onChange={set("nickname")} />
      </Field>
      <Field label="Contact number" htmlFor="own_contact">
        <Input id="own_contact" type="tel" maxLength={40} value={values.contact_number} onChange={set("contact_number")} />
      </Field>
      <Field label="Email" htmlFor="own_email">
        <Input id="own_email" type="email" value={values.email} onChange={set("email")} />
      </Field>
      <Field label="Address" htmlFor="own_address" className="sm:col-span-2">
        <Textarea id="own_address" rows={2} maxLength={300} value={values.address} onChange={set("address")} />
      </Field>
      <div className="sm:col-span-2">
        <PendingButton type="submit" pending={pending} pendingText="Saving…">
          Save my details
        </PendingButton>
      </div>
    </form>
  );
}
