import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full resize-none rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-sm text-foreground shadow-[inset_0_2px_4px_rgba(0,0,0,0.14)] outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
