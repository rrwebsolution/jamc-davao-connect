"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/app/(app)/actions";
import { clearPageCache } from "@/components/app/page-boundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/shared/person-avatar";
import type { ShellUser } from "@/components/app/app-shell";

export function UserMenu({ user }: { user: ShellUser }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-lg p-1 outline-none transition-colors hover:bg-current/5 focus-visible:ring-3 focus-visible:ring-ring/50 lg:pr-2"
        aria-label="Account menu"
      >
        <PersonAvatar name={user.name} src={user.photoUrl} className="size-8" />
        <span className="hidden max-w-36 min-w-0 text-left leading-tight lg:block">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs opacity-65">{user.roleNames[0] ?? "Member"}</span>
        </span>
        <ChevronDown className="hidden size-4 opacity-60 lg:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {user.roleNames.join(", ") || "No role assigned"}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />}>
          <UserRound /> Profile &amp; password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          closeOnClick={false}
          onClick={() => {
            clearPageCache();
            startTransition(() => signOut());
          }}
        >
          {pending ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
