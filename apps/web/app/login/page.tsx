import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isDemo } from "@/lib/env";

const ERRORS: Record<string, string> = {
  scopes: "Flossamer needs both Gmail permissions: read, to find business conversations, and drafts, to save replies. Please allow both.",
  deleted: "Your account and data were deleted.",
};

async function signInWithGoogle() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

export default async function Login({ searchParams }: PageProps<"/login">) {
  if (isDemo) redirect("/");
  const { error } = await searchParams;
  const message = typeof error === "string" ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;

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
      {message && (
        <p role="alert" className="mt-4 max-w-md text-sm text-accent">
          {message}
        </p>
      )}
    </div>
  );
}
