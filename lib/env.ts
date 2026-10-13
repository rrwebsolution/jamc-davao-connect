export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Supabase renamed the anon key to "publishable key"; accept either.
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
