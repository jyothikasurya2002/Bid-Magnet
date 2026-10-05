"use client";

import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatDocument } from "@/lib/tender-chat";

// "[PCAP p.12]" -> a link to that page of the PDF. Written as a markdown link with a
// cite: URL so the parser keeps it inside lists, quotes and tables.
export function linkCitations(text: string) {
  return text.replace(/\[(PCAP|PPT)\b([^\]]*)\](?!\()/gi, (_match, kind: string, rest: string) => {
    const page = rest.match(/\d+/)?.[0] ?? "";
    return `[${kind.toUpperCase()}${page ? ` p.${page}` : ""}](cite:${kind.toLowerCase()}:${page})`;
  });
}

export function ScoutMarkdown({ text, documents }: { text: string; documents: ChatDocument[] }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => (url.startsWith("cite:") ? url : defaultUrlTransform(url))}
      components={{
        a({ href = "", children }) {
          if (href.startsWith("cite:")) {
            const [, kind, page] = href.split(":");
            const doc = documents.find((item) => item.kind === kind);
            return doc ? (
              <a className="chat-cite" href={`${doc.url}${page ? `#page=${page}` : ""}`} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span className="chat-cite">{children}</span>
            );
          }
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        blockquote({ children }) {
          return <blockquote lang="es">{children}</blockquote>;
        },
        table({ children }) {
          return (
            <div className="chat-table">
              <table>{children}</table>
            </div>
          );
        },
      }}
    >
      {linkCitations(text)}
    </Markdown>
  );
}
