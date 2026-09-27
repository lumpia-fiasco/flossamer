import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { GMAIL_SCOPES, isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

async function signInWithGoogle() {
  "use server";
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: GMAIL_SCOPES.join(" "),
      // Offline access + consent so Google returns a refresh token for background sync.
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(data.url);
}

export default async function Login({ searchParams }: PageProps<"/login">) {
  if (isDemo) redirect("/");
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-xl px-4 py-16 md:py-24">
      <p className="font-serif text-2xl">flossamer</p>
      <h1 className="mt-10 max-w-md text-pretty font-serif text-4xl tracking-tight">
        Make great work. We&apos;ll make sure the next project doesn&apos;t slip away.
      </h1>
      <ul className="mt-8 max-w-md space-y-2 text-muted">
        <li>Flossamer reads your email to find business conversations.</li>
        <li>Personal mail is set aside before any AI reads it, and never stored.</li>
        <li>It drafts replies in Gmail for you to send. It never sends anything itself.</li>
      </ul>
      <form action={signInWithGoogle} className="mt-10">
        <button className="rounded-md bg-ink px-5 py-2.5 text-paper">Continue with Google</button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm text-accent">
          {typeof error === "string" ? error : "Sign-in failed. Please try again."}
        </p>
      )}
    </div>
  );
}
