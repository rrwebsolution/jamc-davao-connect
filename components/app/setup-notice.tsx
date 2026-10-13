/** Shown when the Supabase environment variables are missing. */
export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Connect Supabase to continue</h1>
      <p className="text-sm text-muted-foreground">
        This app stores everything in Supabase, and the connection isn&apos;t configured yet.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Copy <code className="rounded bg-muted px-1 py-0.5">.env.example</code> to{" "}
          <code className="rounded bg-muted px-1 py-0.5">.env.local</code> and fill in your project URL and keys.
        </li>
        <li>
          Run the SQL files in <code className="rounded bg-muted px-1 py-0.5">supabase/migrations</code> in order.
        </li>
        <li>
          Create the first Super Admin with{" "}
          <code className="rounded bg-muted px-1 py-0.5">npm run create-admin</code>, then restart the dev server.
        </li>
      </ol>
      <p className="text-sm text-muted-foreground">The README has the full steps.</p>
    </main>
  );
}
