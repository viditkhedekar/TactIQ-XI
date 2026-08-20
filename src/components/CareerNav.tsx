"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/career/squad", label: "Squad" },
  { href: "/career/tactics", label: "Tactics" },
  { href: "/career/training", label: "Training" },
  { href: "/career/transfers", label: "Transfers" },
  { href: "/career/report", label: "Match report" },
  { href: "/career/fixtures", label: "Fixtures" },
  { href: "/career/table", label: "Table" },
  { href: "/career/stats", label: "Statistics" },
];

export function CareerNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col py-1">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`border-l-2 px-3 py-1.5 transition-colors ${
              active
                ? "border-[var(--accent)] bg-[var(--bg-hover)] text-[var(--text)]"
                : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
