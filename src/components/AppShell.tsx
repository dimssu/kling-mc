"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Clapperboard, Folder, Home, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/create", label: "Create", icon: Sparkles },
  { href: "/library", label: "Library", icon: Folder },
  { href: "/usage", label: "Usage", icon: Activity },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
            <Clapperboard className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight">Kling Studio</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--color-bg-elev)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-xs text-[var(--color-fg-muted)]">
          Local dev <span className="text-[var(--color-fg)]">·</span> single-user mode
        </div>
      </aside>

      <header className="md:hidden sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
            <Clapperboard className="h-4 w-4" />
          </span>
          <span className="font-semibold">Kling Studio</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.href === pathname;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "p-2 rounded-[var(--radius-sm)]",
                  active ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]",
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
