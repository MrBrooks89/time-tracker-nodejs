import { requireRole } from "@/lib/permissions";
import { getSettings } from "@/lib/settings-db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const settings = await getSettings();

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">Settings / Workspace Configuration</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Entry limits, close tolerances, and reminder templates applied across
          the app. Changes take effect on the next page load — no deploy
          needed.
        </p>
      </section>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Settings / General</p>
          <CardTitle className="flex flex-wrap items-center gap-3">
            Workspace settings
            <Badge variant="secondary">admin only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            values={{
              max_hours_per_day: String(settings.maxHoursPerDay),
              correction_window_days: String(settings.correctionWindowDays),
              hours_tolerance: String(settings.hoursTolerance),
              ai_model: settings.aiModel,
              reminder_subject: settings.reminderSubject,
              reminder_body: settings.reminderBody,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
