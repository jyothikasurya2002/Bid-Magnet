import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

const USER_AGENT = "BidMagnetProfileBot/1.0 (+company-profile-import)";
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 7;
const PAGE_TIMEOUT_MS = 8_000;

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
};

export type CrawlPageResult = {
  url: string;
  title: string;
  status: "read" | "skipped" | "failed";
  detail?: string;
};

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (!normalized.includes(".")) return false;

  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Website addresses cannot contain credentials.");
  }

  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new Error("Private network addresses are not allowed.");
  }

  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("The website resolves to a private or unavailable address.");
  }
}

async function safeFetch(
  input: URL,
  options: { accept?: string; redirects?: number } = {},
): Promise<{ response: Response; finalUrl: URL }> {
  const redirects = options.redirects ?? 0;
  await assertPublicUrl(input);

  const response = await fetch(input, {
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: options.accept ?? "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });

  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects.");
    const location = response.headers.get("location");
    if (!location) throw new Error("The website returned an invalid redirect.");
    return safeFetch(new URL(location, input), { ...options, redirects: redirects + 1 });
  }

  return { response, finalUrl: new URL(response.url || input) };
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) throw new Error("Page exceeds the 1 MB import limit.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    throw new Error("Page exceeds the 1 MB import limit.");
  }
  return text;
}

function extractPage(html: string, url: URL): CrawledPage {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,canvas,iframe,form,nav").remove();
  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url.hostname;
  const text = $("body")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 35_000);
  return { url: url.toString(), title, text };
}

function scoreLink(url: URL, label: string) {
  const value = `${url.pathname} ${label}`.toLowerCase();
  const positive = [
    "about",
    "company",
    "empresa",
    "nosotros",
    "services",
    "servicios",
    "solutions",
    "soluciones",
    "certif",
    "compliance",
    "security",
    "seguridad",
    "partners",
    "socios",
    "customers",
    "clientes",
    "cases",
    "casos",
    "legal",
    "aviso",
  ];
  const negative = [
    "blog",
    "news",
    "noticias",
    "jobs",
    "empleo",
    "cookies",
    "privacy",
    "privacidad",
    "login",
    "calendar",
    "tag/",
    "author/",
  ];
  if (negative.some((word) => value.includes(word))) return -1;
  return positive.reduce(
    (score, word, index) => score + (value.includes(word) ? 100 - index : 0),
    0,
  );
}

export async function crawlCompanyWebsite(rawUrl: string) {
  const initial = new URL(
    /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`,
  );

  const homepageResult = await safeFetch(initial);
  if (!homepageResult.response.ok) {
    throw new Error(`Website returned ${homepageResult.response.status}.`);
  }
  const contentType = homepageResult.response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error("The website did not return an HTML page.");
  }
  const homepageHtml = await readLimitedText(homepageResult.response);
  const canonicalOrigin = homepageResult.finalUrl.origin;

  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const robotsUrl = new URL("/robots.txt", canonicalOrigin);
    const robotsResult = await safeFetch(robotsUrl, { accept: "text/plain" });
    if (robotsResult.response.ok) {
      robots = robotsParser(robotsUrl.toString(), await readLimitedText(robotsResult.response));
    }
  } catch {
    // An unavailable robots file does not prevent reading the user-provided public page.
  }

  const pages: CrawledPage[] = [extractPage(homepageHtml, homepageResult.finalUrl)];
  const results: CrawlPageResult[] = [
    {
      url: homepageResult.finalUrl.toString(),
      title: pages[0].title,
      status: "read",
    },
  ];

  const $ = cheerio.load(homepageHtml);
  const candidates = new Map<string, { url: URL; score: number }>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, homepageResult.finalUrl);
      url.hash = "";
      if (url.origin !== canonicalOrigin || url.search) return;
      const score = scoreLink(url, $(element).text());
      if (score <= 0) return;
      const key = url.toString().replace(/\/$/, "");
      const existing = candidates.get(key);
      if (!existing || score > existing.score) candidates.set(key, { url, score });
    } catch {
      // Ignore malformed links.
    }
  });

  const selected = [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAGES - 1);

  for (const { url } of selected) {
    if (robots && robots.isAllowed(url.toString(), USER_AGENT) === false) {
      results.push({
        url: url.toString(),
        title: url.pathname,
        status: "skipped",
        detail: "Blocked by robots.txt",
      });
      continue;
    }
    try {
      const pageResult = await safeFetch(url);
      if (!pageResult.response.ok) {
        throw new Error(`HTTP ${pageResult.response.status}`);
      }
      const type = pageResult.response.headers.get("content-type") || "";
      if (!type.includes("text/html")) throw new Error("Unsupported content");
      const page = extractPage(
        await readLimitedText(pageResult.response),
        pageResult.finalUrl,
      );
      if (page.text.length < 80) throw new Error("Page contained no useful text");
      pages.push(page);
      results.push({ url: page.url, title: page.title, status: "read" });
    } catch (error) {
      results.push({
        url: url.toString(),
        title: url.pathname,
        status: "failed",
        detail: error instanceof Error ? error.message : "Could not read page",
      });
    }
  }

  return {
    canonicalUrl: homepageResult.finalUrl.toString(),
    pages,
    results,
  };
}
