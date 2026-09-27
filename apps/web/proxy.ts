import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/inngest"];

/** Sends signed-out visitors to /login. Demo mode (no database) is open. */
export async function proxy(request: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.next();
  if (PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next();

  const session = await auth();
  if (!session?.studioId) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
