"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BellRing,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Role } from "@/lib/session";

export interface NavItem {
  label: string;
  href: string;
}

const iconMap: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  week: CalendarDays,
  reports: BarChart3,
  approvals: ClipboardCheck,
  employees: Users,
  projects: FolderKanban,
  calendar: CalendarRange,
  audit: ScrollText,
  reminders: BellRing,
};

const baseItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "My Week", href: "/week" },
  { label: "Reports", href: "/reports" },
];

const manageItems: NavItem[] = [
  { label: "Approvals", href: "/approvals" },
  { label: "Employees", href: "/employees" },
  { label: "Projects", href: "/projects" },
];

// Admin-only pages (DA-009 audit viewer, FC-003/FC-008 calendar admin,
// TS-019/020 reminders) — the nav links follow the same gate as the
// server-side requireRole checks.
const adminItems: NavItem[] = [
  { label: "Calendar", href: "/calendar" },
  { label: "Reminders", href: "/reminders" },
  { label: "Audit", href: "/audit" },
];

// Section 1.4: per-role nav visibility. This is COSMETIC ONLY — every page
// and server action re-verifies the role server-side (permissions.ts).
const roleItems: Record<Role, NavItem[]> = {
  admin: [...baseItems, ...manageItems, ...adminItems],
  manager: [...baseItems, ...manageItems],
  employee: baseItems,
  // finance_viewer: classification/actuals totals only.
  finance_viewer: [{ label: "Reports", href: "/reports" }],
  // leadership: read-only dashboards + reports.
  leadership: [
    { label: "Dashboard", href: "/" },
    { label: "Reports", href: "/reports" },
  ],
  // project_manager: dashboard, their projects, project-scoped reports.
  project_manager: [
    { label: "Dashboard", href: "/" },
    { label: "Projects", href: "/projects" },
    { label: "Reports", href: "/reports" },
  ],
};

function itemKey(href: string): string {
  return href.replace(/^\//, "");
}

export function AppNav({
  role,
  className,
  orientation = "vertical",
}: {
  role: Role;
  className?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();

  const items = roleItems[role];

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
