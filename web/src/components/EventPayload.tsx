import { useEffect, useMemo, useState } from "react";
import { highlight } from "../lib/highlighter";

type Props = {
  text: string;
};

const URL_RE = /\bhttps?:\/\/[^\s)"'<>]+/g;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|flac)(\?.*)?$/i;

type MediaKind = "image" | "video" | "audio" | "link";

function classifyUrl(url: string): MediaKind {
  if (IMG_EXT_RE.test(url)) return "image";
  if (VIDEO_EXT_RE.test(url)) return "video";
  if (AUDIO_EXT_RE.test(url)) return "audio";
  return "link";
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; media: MediaKind };

function parseSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ kind: "text", value: text.slice(last, idx) });
    segs.push({ kind: "url", value: m[0], media: classifyUrl(m[0]) });
    last = idx + m[0].length;
  }
  if (last < text.length) segs.push({ kind: "text", value: text.slice(last) });
  return segs;
}

function extractMediaUrls(text: string): Array<{ url: string; media: MediaKind }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; media: MediaKind }> = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (seen.has(url)) continue;
    const media = classifyUrl(url);
    if (media === "link") continue;
    seen.add(url);
    out.push({ url, media });
  }
  return out;
}

function tryDetectStructured(text: string): { lang: string; code: string } | null {
  const t = text.trim();
  // Strip "result: " / "← " / "→ " prefix from our event-type formatting.
  const cleaned = t.replace(/^(result:\s*|←\s*|→\s*)/, "");
  if (
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(cleaned);
      return { lang: "json", code: JSON.stringify(parsed, null, 2) };
    } catch {
      /* not JSON */
    }
  }
  // Tool calls like `bash({"command":"..."})` → highlight the inside as json.
  const m = cleaned.match(/^(\w+)\(\s*(\{.*\}|\[.*\])\s*\)$/s);
  if (m) {
    try {
      const parsed = JSON.parse(m[2]);
      return { lang: "json", code: `// ${m[1]}\n${JSON.stringify(parsed, null, 2)}` };
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function MediaPreview({ url, media }: { url: string; media: MediaKind }) {
  if (media === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{
            maxWidth: "100%",
            maxHeight: 220,
            borderRadius: 6,
            border: "1px solid var(--border)",
            display: "block",
          }}
        />
      </a>
    );
  }
  if (media === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: agent-generated content; captions unavailable.
      <video
        src={url}
        controls
        preload="metadata"
        style={{
          maxWidth: "100%",
          maxHeight: 260,
          borderRadius: 6,
          border: "1px solid var(--border)",
          display: "block",
          background: "#000",
        }}
      />
    );
  }
  if (media === "audio") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: agent-generated content; captions unavailable.
      <audio src={url} controls preload="metadata" style={{ width: "100%" }} />
    );
  }
  return null;
}

function MediaStrip({ items }: { items: Array<{ url: string; media: MediaKind }> }) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: items.length === 1 ? "1fr" : "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 6,
        marginTop: 6,
      }}
    >
      {items.map((m) => (
        <MediaPreview key={m.url} url={m.url} media={m.media} />
      ))}
    </div>
  );
}

export function EventPayload({ text }: Props) {
  const structured = useMemo(() => tryDetectStructured(text), [text]);
  const segments = useMemo(() => parseSegments(text), [text]);
  const media = useMemo(() => extractMediaUrls(text), [text]);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!structured) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    highlight(structured.code, structured.lang)
      .then((h) => {
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [structured]);

  if (structured) {
    return (
      <>
        {html ? (
          <div
            className="braid-codeblock"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted, server-rendered HTML.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre style={{ margin: 0, fontSize: 11.5, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
            {structured.code}
          </pre>
        )}
        <MediaStrip items={media} />
      </>
    );
  }

  return (
    <div style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5 }}>
      {segments.map((s, i) => {
        if (s.kind === "text") {
          return <span key={`t-${i}-${s.value.slice(0, 8)}`}>{s.value}</span>;
        }
        return (
          <span key={`u-${i}-${s.value}`}>
            <a
              href={s.value}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--link-muted)",
                textDecoration: "underline",
                wordBreak: "break-all",
              }}
            >
              {s.value}
            </a>
            {s.media !== "link" ? (
              <div style={{ marginTop: 6 }}>
                <MediaPreview url={s.value} media={s.media} />
              </div>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
