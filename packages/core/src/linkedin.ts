import type { Person } from "./types";

/**
 * LinkedIn data the user already owns (PRD 6.12): their data export and the
 * notification emails LinkedIn sends them. Nothing here talks to LinkedIn.
 */

export interface LinkedInConnection {
  profileUrl: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  /** YYYY-MM-DD */
  connectedOn: string | null;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "15 Sep 2024", "Sep 15, 2024", "09/15/24" or ISO, to YYYY-MM-DD. */
export function parseLinkedInDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
  if (m) return `${m[3]}-${MONTHS[m[2]!.toLowerCase()] ?? "01"}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/);
  if (m) return `${m[3]}-${MONTHS[m[1]!.toLowerCase()] ?? "01"}-${m[2]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/**
 * Connections.csv from a LinkedIn data export. The file starts with a few lines
 * of notes, so the header row is found by name, and columns are read by name.
 */
export function parseLinkedInConnections(text: string): { connections: LinkedInConnection[]; skipped: number } {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((r) => {
    const cells = r.map((c) => c.trim().toLowerCase());
    return cells.includes("first name") && cells.includes("last name");
  });
  if (headerIndex === -1) throw new Error("This doesn't look like LinkedIn's Connections.csv (no First Name / Last Name columns).");

  const header = rows[headerIndex]!.map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    first: col("first name"),
    last: col("last name"),
    url: col("url", "profile url"),
    email: col("email address", "email"),
    company: col("company"),
    position: col("position", "title"),
    connected: col("connected on"),
  };

  const connections: LinkedInConnection[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerIndex + 1)) {
    if (r.every((c) => c.trim() === "")) continue;
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const firstName = get(idx.first);
    const lastName = get(idx.last);
    const profileUrl = get(idx.url);
    if (!firstName || !/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(profileUrl)) {
      skipped++;
      continue;
    }
    connections.push({
      profileUrl: profileUrl.replace(/\/+$/, ""),
      firstName,
      lastName,
      email: get(idx.email).toLowerCase() || null,
      company: get(idx.company) || null,
      position: get(idx.position) || null,
      connectedOn: get(idx.connected) ? parseLinkedInDate(get(idx.connected)) : null,
    });
  }
  return { connections, skipped };
}

/** For name matching: lowercase, no accents, no credentials or emoji, single spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/,.*$/, "") // "Maya Chen, PhD"
    .replace(/\([^)]*\)/g, "") // "Maya (she/her) Chen"
    .replace(/[^\p{L}\p{N}' -]/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface ConnectionMatch {
  profileUrl: string;
  personId: string;
  /** Email is the same identity key; a name match is only a suggestion (LI-02). */
  how: "email" | "name";
}

/** LI-02: match connections to known people. Never guesses when a name is shared. */
export function matchConnections(connections: LinkedInConnection[], people: Person[]): ConnectionMatch[] {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of people) {
    for (const e of p.emails) byEmail.set(e.toLowerCase(), p.id);
    const key = normalizeName(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
  }

  const matches: ConnectionMatch[] = [];
  for (const c of connections) {
    const emailMatch = c.email ? byEmail.get(c.email) : undefined;
    if (emailMatch) {
      matches.push({ profileUrl: c.profileUrl, personId: emailMatch, how: "email" });
      continue;
    }
    const candidates = byName.get(normalizeName(`${c.firstName} ${c.lastName}`)) ?? [];
    if (candidates.length === 1) matches.push({ profileUrl: c.profileUrl, personId: candidates[0]!, how: "name" });
  }
  return matches;
}

/** LI-03: a connection whose company changed between two imports. */
export function companyChanged(before: { company: string | null }, after: { company: string | null }): boolean {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(norm(before.company) && norm(after.company) && norm(before.company) !== norm(after.company));
}

export type LinkedInNotification =
  | { kind: "new_position"; name: string; position: string | null; company: string | null }
  | { kind: "post"; name: string; text: string | null };

const POSITION_PATTERNS = [
  /^congratulate (.+?) (?:for|on) (?:starting a new (?:position|job|role)|(?:their|his|her) new (?:position|job|role)|the new (?:position|job|role))(?: as (.+?))?(?: at (.+?))?[.!]?$/i,
  /^(.+?) (?:started|has started|is starting|just started) a new (?:position|job|role)(?: as (.+?))?(?: at (.+?))?[.!]?$/i,
  /^(.+?) (?:is now|has joined|joined) (.+?)(?: at (.+?))?[.!]?$/i,
];
const POST_PATTERN = /^(.+?) (?:posted|shared a post|shared an update|shared an article|just posted)(?:[:,]\s*(.+))?$/i;

/**
 * LI-06, LI-07: read a LinkedIn notification from its sender and subject line only.
 * Returns null for anything that isn't a new position or a post by a named person.
 */
export function parseLinkedInNotification(from: string, subject: string): LinkedInNotification | null {
  if (!/@([a-z0-9-]+\.)*linkedin\.com>?\s*$/i.test(from.trim())) return null;
  const s = subject.replace(/\s+/g, " ").trim();

  for (const [i, re] of POSITION_PATTERNS.entries()) {
    const m = s.match(re);
    if (!m) continue;
    if (i === 2) {
      // "X is now Head of Design at Atlas" / "X joined Atlas": the second group is a role or a company.
      const [, name, roleOrCompany, company] = m;
      return { kind: "new_position", name: name!.trim(), position: company ? roleOrCompany!.trim() : null, company: (company ?? roleOrCompany)!.trim() };
    }
    return { kind: "new_position", name: m[1]!.trim(), position: m[2]?.trim() ?? null, company: m[3]?.trim() ?? null };
  }

  const post = s.match(POST_PATTERN);
  if (post && !/^(you|your|someone|people|\d+)/i.test(post[1]!)) {
    return { kind: "post", name: post[1]!.trim(), text: post[2]?.trim() || null };
  }
  return null;
}

/** The one known person with this exact name, or null when there's none or more than one. */
export function personByName(people: Person[], name: string): Person | null {
  const key = normalizeName(name);
  const found = people.filter((p) => normalizeName(p.name) === key);
  return found.length === 1 ? found[0]! : null;
}
