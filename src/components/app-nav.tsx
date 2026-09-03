"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href: string;
}

const iconMap: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  week: CalendarDays,
  reports: BarChart3,
  employees: Users,
  projects: FolderKanban,
};

const baseItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "My Week", href: "/week" },
  { label: "Reports", href: "/reports" },
];

const manageItems: NavItem[] = [
  { label: "Employees", href: "/employees" },
  { label: "Projects", href: "/projects" },
];

function itemKey(href: string): string {
  return href.replace(/^\//, "");
}

export function AppNav({
  manage,
  className,
  orientation = "vertical",
}: {
  manage: boolean;
  className?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();

  const items = manage ? [...baseItems, ...manageItems] : baseItems;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav
      aria-label="Primary"
      className={cn(
        orientation === "vertical"
          ? "flex flex-col gap-1"
          : "flex flex-row gap-1 overflow-x-auto",
        className,
      )}
    >
      {items.map((item) => {
        const Icon = iconMap[itemKey(item.href)] ?? LayoutDashboard;
        const active = isActive(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold tracking-tight transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 hover:-translate-y-0.5",
              orientation === "horizontal" && "shrink-0",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_10px_28px_-12px_var(--sidebar-primary)]"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/15 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
