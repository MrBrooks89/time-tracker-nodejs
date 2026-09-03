import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "destructive";

const variants: Record<Variant, string> = {
  default:
    "border-primary/30 bg-primary/15 text-primary",
  secondary: "border-border bg-secondary/60 text-secondary-foreground",
  outline: "border-border bg-transparent text-muted-foreground",
  destructive:
    "border-destructive/30 bg-destructive/15 text-destructive",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & {
  variant?: Variant;
}) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wider whitespace-nowrap [&_svg]:size-3",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
