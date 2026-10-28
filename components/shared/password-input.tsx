"use client";

import { useState } from "react";
import { Check, Copy, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// No characters that are easy to mix up when the password is read out or
// copied by hand: 0/O, 1/l/I.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;

function pick(set: string, random: number) {
  return set[random % set.length];
}

/**
 * A temporary password like "Kx7m-Pq4t-Wz9r": three groups of four, with at
 * least one capital, one small letter and one digit. About 71 bits of
 * randomness from the browser's secure generator.
 */
export function generatePassword() {
  const random = new Uint32Array(12);
  crypto.getRandomValues(random);
  const chars = Array.from(random, (value) => pick(ALL, value));
  // Guarantee each kind at a random place in its own group.
  const kinds = [LOWER, UPPER, DIGITS];
  const places = new Uint32Array(3);
  crypto.getRandomValues(places);
  kinds.forEach((set, group) => {
    const index = group * 4 + (places[group] % 4);
    chars[index] = pick(set, random[index]);
  });
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((part) => part.join("")).join("-");
}

/**
 * A temporary password field for a new account: typed, or generated with one
 * click, and copied to pass on to the member. Shown in plain text, because the
 * person setting it has to share it.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Password copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the password and copy it instead.");
    }
  }

  return (
    <div className="flex flex-wrap gap-2 sm:flex-nowrap">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1 font-mono"
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex gap-2 max-sm:w-full">
        <Button type="button" variant="outline" disabled={disabled} className="max-sm:flex-1" onClick={() => onChange(generatePassword())}>
          <WandSparkles /> Generate
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || !value}
          onClick={copy}
          aria-label="Copy password"
          title="Copy password"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
