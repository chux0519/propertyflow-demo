import "server-only";
import { createClient } from "@supabase/supabase-js";

// Read-only access with the publishable key; RLS limits it to active listings
// and the public columns of import runs. No secret key is ever used by the web app.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
