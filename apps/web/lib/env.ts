/**
 * Demo mode: with no database configured, the app runs on the sample studio
 * from @flossamer/core so it can be developed and shown without accounts.
 */
export const isDemo = !process.env.DATABASE_URL;

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

/** Gmail scopes. gmail.compose saves drafts; there is no send scope in use. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
