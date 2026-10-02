import { NextResponse } from "next/server";
import { z } from "zod";
import { extractWebsiteSuggestions } from "@/lib/ai";
import { crawlCompanyWebsite } from "@/lib/crawler";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  url: z.string().trim().min(3).max(2_048),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in before importing a website." }, { status: 401 });
    }

    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid company website." }, { status: 400 });
    }

    const crawl = await crawlCompanyWebsite(parsed.data.url);
    const suggestions = await extractWebsiteSuggestions(
      crawl.pages,
      crawl.canonicalUrl,
    );

    return NextResponse.json({
      canonical_url: crawl.canonicalUrl,
      checked_pages: crawl.results,
      suggestions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website import failed.";
    const safeMessage =
      message.includes("OPENAI_API_KEY") ||
      message.includes("Only HTTP") ||
      message.includes("Private network") ||
      message.includes("resolves to") ||
      message.includes("Website returned") ||
      message.includes("HTML") ||
      message.includes("limit")
        ? message
        : "We could not review that website. Check the address and try again.";

    return NextResponse.json({ error: safeMessage }, { status: 422 });
  }
}
