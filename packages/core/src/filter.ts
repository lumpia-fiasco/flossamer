import type { MailClass } from "./types";

/**
 * Business filter (EM-02). Runs on headers and sender signals only, before any
 * model sees the message. Anything it can't decide is "undecided" and goes to a
 * small classifier; anything "personal" has its content discarded right away.
 */

export interface MessageHeaders {
  from: string;
  to: string[];
  /** Gmail label ids, e.g. CATEGORY_PROMOTIONS, SENT. */
  labels: string[];
  listUnsubscribe: boolean;
  precedence: string | null;
  autoSubmitted: string | null;
}

export interface Exclusions {
  senders: string[];
  domains: string[];
  labels: string[];
}

export interface FilterContext {
  exclusions: Exclusions;
  /** Addresses of confirmed business contacts. */
  knownBusinessContacts: Set<string>;
  /** Addresses the user has written to from this account. */
  addressesUserWroteTo: Set<string>;
}

const AUTOMATED_CATEGORIES = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

const NO_REPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce)[+@.]/i;

/** Consumer domains: a sender here could be a client or a friend. */
export const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function emailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim().toLowerCase();
}

export function domainOf(address: string): string {
  return address.split("@")[1] ?? "";
}

/** The other side of the conversation: the sender, or for sent mail the first recipient. */
export function counterpartOf(h: Pick<MessageHeaders, "from" | "to" | "labels">): string {
  const sent = h.labels.includes("SENT");
  return emailAddress(sent ? (h.to[0] ?? "") : h.from);
}

export function classifyByHeaders(h: MessageHeaders, ctx: FilterContext): MailClass {
  const sent = h.labels.includes("SENT");
  const from = counterpartOf(h);
  const domain = domainOf(from);
  const { exclusions } = ctx;

  // User exclusions always win (EM-03).
  if (
    exclusions.senders.includes(from) ||
    exclusions.domains.includes(domain) ||
    h.labels.some((l) => exclusions.labels.includes(l))
  ) {
    return "personal";
  }

  if (
    !sent &&
    (h.listUnsubscribe ||
      h.labels.some((l) => AUTOMATED_CATEGORIES.has(l)) ||
      NO_REPLY.test(from) ||
      (h.precedence !== null && /bulk|list|junk/i.test(h.precedence)) ||
      (h.autoSubmitted !== null && h.autoSubmitted !== "no"))
  ) {
    return "automated";
  }

  if (ctx.knownBusinessContacts.has(from)) return "business";

  // A company domain the user has corresponded with (or is writing to) is very likely business.
  if (!CONSUMER_DOMAINS.has(domain) && (sent || ctx.addressesUserWroteTo.has(from))) {
    return "business";
  }

  return "undecided";
}
