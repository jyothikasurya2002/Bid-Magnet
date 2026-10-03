import { NextResponse } from "next/server";
import { z } from "zod";
import { companyFromRow } from "@/lib/profile";
import { startCompanyResearch } from "@/lib/research";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const RequestSchema = z.object({
  url: z.string().trim().min(3).max(2_048),
  companyId: z.string().uuid(),
});

function normalizeWebsite(raw: string) {
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
    throw new Error("Enter a public website address, like yourcompany.es.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

// Starts a background research job and returns its id; the page polls GET /[id].
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before researching a website." }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid company website." }, { status: 400 });
  }

  let website: string;
  try {
    website = normalizeWebsite(parsed.data.url);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Enter") ? error.message : "Enter a valid company website.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Row-level security limits this to the user's own company.
  const { data: row } = await supabase
    .from("companies")
    .select("*")
    .eq("id", parsed.data.companyId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  try {
    const id = await startCompanyResearch({
      website,
      company: companyFromRow(row),
      userId: user.id,
      companyId: parsed.data.companyId,
    });
    return NextResponse.json({ id, website });
  } catch (error) {
    console.error("research start failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: `Couldn't start the research: ${message}` }, { status: 502 });
  }
}
