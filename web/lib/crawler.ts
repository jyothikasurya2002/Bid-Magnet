import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";

// A browser-like agent: many company sites refuse unknown bots outright.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 BidMagnet/1.0";
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const PAGE_TIMEOUT_MS = 8_000;

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
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
  options: { accept?: string; redirects?: number; timeoutMs?: number } = {},
): Promise<{ response: Response; finalUrl: URL }> {
  const redirects = options.redirects ?? 0;
  await assertPublicUrl(input);

  const response = await fetch(input, {
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: options.accept ?? "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? PAGE_TIMEOUT_MS),
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
    .slice(0, 200_000);
  return { url: url.toString(), title, text };
}

// Text of one public HTML page, for checking a quote the research agent cites.
export async function fetchPageText(rawUrl: string) {
  const { response, finalUrl } = await safeFetch(new URL(rawUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) throw new Error("Not an HTML page");
  return extractPage(await readLimitedText(response), finalUrl);
}

const MAX_PDF_BYTES = 20_000_000;

// A tender PDF from a public procurement platform (PLACSP can take 10+ seconds).
export async function fetchPdf(rawUrl: string) {
  const { response } = await safeFetch(new URL(rawUrl), { accept: "application/pdf", timeoutMs: 30_000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || "0") > MAX_PDF_BYTES) throw new Error("PDF is too large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new Error("PDF is too large");
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Not a PDF");
  return bytes;
}
