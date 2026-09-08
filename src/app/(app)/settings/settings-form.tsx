"use client";

import { Fragment, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateSettings } from "@/lib/actions/settings";
import { SETTING_KEYS, type SettingKey } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SettingsValues = Record<SettingKey, string>;
type FieldErrors = Partial<Record<SettingKey, string>>;

interface FieldConfig {
  key: SettingKey;
  label: string;
  hint: string;
  placeholder: string;
  /** Defaults to "number" for non-template fields; text renders a mono
   * string input (used by ai_model, which is a provider/model string). */
  inputType?: "number" | "text";
}

const numericFields: FieldConfig[] = [
  {
    key: "max_hours_per_day",
    label: "Max hours per day",
    hint: "Daily cap enforced when a timesheet is saved (1–24).",
    placeholder: "16",
  },
  {
    key: "correction_window_days",
    label: "Correction window (days)",
    hint: "Business days partners have to correct flagged sheets after a close is initiated (1–20).",
    placeholder: "5",
  },
  {
    key: "hours_tolerance",
    label: "Hours tolerance",
    hint: "Exception-report threshold as a fraction of expected hours: |actual − expected| ÷ expected (0–1).",
    placeholder: "0.8",
  },
];

const templateFields: FieldConfig[] = [
  {
    key: "reminder_subject",
    label: "Reminder subject template",
    hint: "Required placeholders: {week}, {due_date}.",
    placeholder: "Timesheet reminder — week of {week} due {due_date}",
  },
  {
    key: "reminder_body",
    label: "Reminder body template",
    hint: "Required placeholders: {partner}, {week}, {due_date}. Optional: {hours}.",
    placeholder: "Hi {partner}, …",
  },
];

export function SettingsForm({ values }: { values: SettingsValues }) {
  const router = useRouter();
  const fieldId = useId();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const input: Partial<Record<SettingKey, string>> = {};
    for (const key of SETTING_KEYS) {
      const value = formData.get(key);
      if (typeof value === "string") input[key] = value;
    }
    setError(null);
    setSaved(false);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateSettings(input);
      if (!result.ok) {
        setFieldErrors(result.errors ?? {});
        setError(
          result.error ?? "Fix the highlighted fields and try again.",
        );
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function renderField(config: FieldConfig, isTemplate: boolean) {
    const fieldError = fieldErrors[config.key];
    const commonProps = {
      id: `${fieldId}-${config.key}`,
      name: config.key,
      defaultValue: values[config.key],
      disabled: isPending,
      "aria-invalid": fieldError ? true : undefined,
    };
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${fieldId}-${config.key}`}>{config.label}</Label>
        {isTemplate && config.key === "reminder_body" ? (
          <Textarea
            {...commonProps}
            rows={6}
            className="font-mono text-xs leading-5"
            placeholder={config.placeholder}
          />
        ) : isTemplate || config.inputType === "text" ? (
          <Input
            {...commonProps}
            type="text"
            className="font-mono text-xs"
            placeholder={config.placeholder}
          />
        ) : (
          <Input
            {...commonProps}
            type="number"
            inputMode="decimal"
            min={config.key === "hours_tolerance" ? 0 : 1}
            max={config.key === "max_hours_per_day" ? 24 : config.key === "correction_window_days" ? 20 : 1}
            step={config.key === "hours_tolerance" ? 0.05 : 1}
            className="font-mono"
            placeholder={config.placeholder}
          />
        )}
        {fieldError ? (
          <p className="text-xs font-medium text-destructive">{fieldError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{config.hint}</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {numericFields.map((field) => (
          <Fragment key={field.key}>{renderField(field, false)}</Fragment>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]">
        <div className="flex flex-col gap-1">
          <p className="micro-label">Settings / AI Helper</p>
          <p className="text-xs text-muted-foreground">
            TokenRouter model string (provider/model). Leave blank to use the
            built-in default — the classification helper hides itself when no
            API key is configured.
          </p>
        </div>
        {renderField(
          {
            key: "ai_model",
            label: "AI model",
            hint: "e.g. z-ai/glm-5.3-free. Blank = default (openai/gpt-5.6-sol).",
            placeholder: "provider/model",
            inputType: "text",
          },
          false,
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]">
        <div className="flex flex-col gap-1">
          <p className="micro-label">Settings / Reminder Templates</p>
          <p className="text-xs text-muted-foreground">
            Used by reminder emails. These templates are also editable on the
            Reminders page — both editors write the same stored settings.
          </p>
        </div>
        <div className="grid gap-4">
          {templateFields.map((field) => (
            <Fragment key={field.key}>{renderField(field, true)}</Fragment>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      {saved && !error ? (
        <p className="text-sm font-medium text-accent">
          Settings saved — changes are live.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
