import { NextResponse } from "next/server";
import { cancelCompanyResearch, readCompanyResearch, ResearchNotFound } from "@/lib/research";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// The finished poll re-opens cited pages to check quotes.
export const maxDuration = 60;

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function failure(error: unknown, action: string) {
  if (error instanceof ResearchNotFound) {
    return NextResponse.json({ error: "Research not found." }, { status: 404 });
  }
  console.error(`research ${action} failed`, error);
  const message = error instanceof Error ? error.message : "unknown error";
  return NextResponse.json({ error: `Couldn't ${action} the research: ${message}` }, { status: 502 });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/company/research/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await readCompanyResearch(id, user.id));
  } catch (error) {
    return failure(error, "check");
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/company/research/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await cancelCompanyResearch(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "cancel");
  }
}
