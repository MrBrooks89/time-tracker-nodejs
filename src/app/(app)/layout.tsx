import { Clock } from "lucide-react";

import { requireUser } from "@/lib/session";
import { canManagePeople } from "@/lib/permissions";
import { AppNav } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const manage = canManagePeople(user.role);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="sticky top-0 z-20 flex shrink-0 flex-col gap-0 border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:h-dvh lg:w-72 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-4 lg:px-6 lg:py-6">
          <span className="command-strip flex size-10 shrink-0 items-center justify-center rounded-full text-primary-foreground shadow-[0_10px_28px_-12px_var(--primary)]">
            <Clock className="size-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-bold tracking-tight">
              Time Tracker
            </span>
            <span className="micro-label">Command Deck</span>
          </span>
        </div>

        <div className="border-t border-sidebar-border px-2 py-2 lg:hidden">
          <AppNav manage={manage} orientation="horizontal" />
        </div>

        <div className="hidden flex-1 flex-col px-3 py-4 lg:flex">
          <AppNav manage={manage} />
        </div>

        <div className="hidden flex-col gap-3 border-t border-sidebar-border px-4 py-4 lg:flex lg:px-6">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold leading-none tracking-tight">
              {user.name}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">{user.role}</Badge>
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="planner-bg flex-1 overflow-hidden">
        <div className="container mx-auto max-w-[1500px] px-4 py-8 lg:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
