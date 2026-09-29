import type { MessageHeaders } from "@flossamer/core";
import type { MailSource, MessageRef, SourceHeaders } from "./index";

/**
 * Gmail REST client (CN-01). Scopes: gmail.readonly to read, gmail.compose to
 * save drafts. There is deliberately no send method.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const METADATA_HEADERS = ["From", "To", "Subject", "Date", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted", "Message-ID", "References"];

export class GmailAuthError extends Error {}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType: string;
  headers?: GmailHeader[];
  body?: { data?: string; size: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPart;
}

export interface GmailCredentials {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

const htmlToText = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');

/** Drop quoted history so each message is sent to the model once, not once per reply. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (l) => /^On .+ wrote:\s*$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^From: .+/.test(l) && lines.some((x) => x.startsWith(">")),
  );
  return (cut === -1 ? lines : lines.slice(0, cut))
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function messageText(payload: GmailPart): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return stripQuoted(decodeBase64Url(plain.body.data));
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripQuoted(htmlToText(decodeBase64Url(html.body.data)));
  return "";
}

const header = (m: GmailMessage, name: string) =>
  m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

const splitAddresses = (value: string | null) =>
  value ? value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean) : [];

export class GmailSource implements MailSource {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly creds: GmailCredentials) {}

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      // invalid_grant = the user revoked access or the token expired.
      throw new GmailAuthError(`Token refresh failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${await this.token()}` },
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && attempt === 0) {
        this.accessToken = null;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new GmailAuthError(`Gmail ${res.status}: ${await res.text()}`);
      throw new Error(`Gmail ${res.status} on ${path}: ${await res.text()}`);
    }
  }

  async profile(): Promise<{ emailAddress: string }> {
    return this.request("/profile");
  }

  async list({ after, pageToken }: { after: string; pageToken: string | null }) {
    const params = new URLSearchParams({
      q: `after:${Math.floor(Date.parse(after) / 1000)}`,
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await this.request<{ messages?: MessageRef[]; nextPageToken?: string }>(`/messages?${params}`);
    return { refs: res.messages ?? [], nextPageToken: res.nextPageToken ?? null };
  }

  private async metadata(id: string): Promise<GmailMessage> {
    const params = new URLSearchParams({ format: "metadata" });
    for (const h of METADATA_HEADERS) params.append("metadataHeaders", h);
    return this.request<GmailMessage>(`/messages/${id}?${params}`);
  }

  async headers(id: string): Promise<SourceHeaders> {
    const m = await this.metadata(id);
    return toSourceHeaders(m);
  }

  async body(id: string): Promise<string> {
    const m = await this.request<GmailMessage>(`/messages/${id}?format=full`);
    return messageText(m.payload);
  }

  /** Whole thread with bodies, for extraction and drafting. Held in memory only. */
  async thread(threadId: string): Promise<{ id: string; headers: SourceHeaders; body: string }[]> {
    const t = await this.request<{ messages: GmailMessage[] }>(`/threads/${threadId}?format=full`);
    return t.messages.map((m) => ({ id: m.id, headers: toSourceHeaders(m), body: messageText(m.payload) }));
  }

  /** Recent sent mail, for learning the user's voice (VC-01). */
  async recentSentBodies(limit: number): Promise<string[]> {
    const res = await this.request<{ messages?: MessageRef[] }>(`/messages?${new URLSearchParams({ q: "in:sent", maxResults: String(limit) })}`);
    const bodies: string[] = [];
    for (const ref of res.messages ?? []) bodies.push(await this.body(ref.id));
    return bodies.filter((b) => b.length > 40);
  }

  /** Save a draft in the thread (VC-03). Returns the draft id for a Gmail link. */
  async createDraft(opts: { threadId: string | null; to: string; subject: string; body: string; inReplyTo: string | null }) {
    const lines = [
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
      "",
      opts.body,
    ];
    return this.request<{ id: string; message: { id: string; threadId: string } }>("/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { raw: encodeBase64Url(lines.join("\r\n")), ...(opts.threadId ? { threadId: opts.threadId } : {}) },
      }),
    });
  }
}

function toSourceHeaders(m: GmailMessage): SourceHeaders {
  const headers: MessageHeaders = {
    from: header(m, "From") ?? "",
    to: splitAddresses(header(m, "To")),
    labels: m.labelIds ?? [],
    listUnsubscribe: header(m, "List-Unsubscribe") !== null,
    precedence: header(m, "Precedence"),
    autoSubmitted: header(m, "Auto-Submitted"),
  };
  return {
    ...headers,
    threadId: m.threadId,
    subject: header(m, "Subject") ?? "",
    snippet: decodeEntities(m.snippet),
    date: new Date(Number(m.internalDate)).toISOString(),
    messageId: header(m, "Message-ID"),
    listId: header(m, "List-Id"),
    listUnsubscribeValue: header(m, "List-Unsubscribe"),
  };
}

const decodeEntities = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
