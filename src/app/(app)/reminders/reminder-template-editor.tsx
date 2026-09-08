"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

import { updateReminderTemplates } from "@/lib/actions/reminder-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDERS = "{partner} · {week} · {due_date} · {hours}" as const;

export function ReminderTemplateEditor({
  subject,
  body,
}: {
  subject: string;
  body: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subjectValue, setSubjectValue] = useState(subject);
  const [bodyValue, setBodyValue] = useState(body);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateReminderTemplates({
        reminderSubject: subjectValue,
        reminderBody: bodyValue,
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "Could not save." });
        return;
      }
      setMessage({ ok: true, text: "Templates saved." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="reminder-subject">Subject template</Label>
        <Input
          id="reminder-subject"
          value={subjectValue}
          onChange={(event) => setSubjectValue(event.target.value)}
          placeholder="Timesheet reminder: week of {week} due {due_date}"
          disabled={isPending}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reminder-body">Body template</Label>
        <Textarea
          id="reminder-body"
          value={bodyValue}
          onChange={(event) => setBodyValue(event.target.value)}
          rows={10}
          placeholder="Hi {partner}, …"
          disabled={isPending}
          className="min-h-40"
        />
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Placeholders: <span className="text-accent">{PLACEHOLDERS}</span>
        — subject requires {"{week}"} and {"{due_date}"}, body also requires{" "}
        {"{partner}"}. Unfilled placeholders are left as-is in the email.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={isPending}
        >
          <Mail className="size-4" />
          {isPending ? "Saving…" : "Save templates"}
        </Button>
        {message ? (
          <span
            className={
              message.ok
                ? "text-sm font-semibold text-accent"
                : "text-sm font-semibold text-destructive"
            }
            role="status"
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
