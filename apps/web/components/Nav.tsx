"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "This week" },
  { href: "/conversations", label: "Conversations" },
  { href: "/people", label: "People" },
  { href: "/work", label: "Work" },
  { href: "/studio", label: "Studio" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="border-b border-rule px-4 py-3 print:hidden md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r md:px-6 md:py-10"
    >
      <p className="font-serif text-xl tracking-tight md:mb-10">flossamer</p>
      <ul className="-mx-2 mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none] md:mt-0 md:flex-col md:gap-0.5">
        {LINKS.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-md px-2 py-1.5 text-sm ${
                  active ? "bg-accent-soft text-ink font-medium" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
