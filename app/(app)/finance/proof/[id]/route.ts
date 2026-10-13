import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/data/common";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a giving record's proof of payment. The bucket is private: this looks
 * the record up as the signed-in user (so RLS decides whether they may see it)
 * and redirects to a link that works for one minute.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/finance/proof/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: record } = await supabase.from("giving_records").select("proof_path").eq("id", id).maybeSingle();
  if (!record?.proof_path) {
    // Either there is no proof, or this user is not allowed to see the record.
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: signed, error } = await supabase.storage.from("payment-proofs").createSignedUrl(record.proof_path, 60);
  if (error || !signed?.signedUrl) {
    return new NextResponse("The file could not be opened.", { status: 404 });
  }
  return NextResponse.redirect(signed.signedUrl);
}
