import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "sm" | "default" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default:
    "command-strip text-primary-foreground shadow-[0_10px_32px_-12px_var(--primary)] hover:shadow-[0_14px_38px_-12px_var(--primary)] hover:-translate-y-0.5",
  outline:
    "border border-border bg-secondary/40 text-foreground backdrop-blur-sm hover:border-primary/60 hover:text-primary hover:-translate-y-0.5",
  ghost:
    "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  destructive:
    "bg-destructive text-destructive-foreground shadow-[0_10px_30px_-12px_var(--destructive)] hover:-translate-y-0.5",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  default: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "size-10 px-0",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-bold tracking-tight whitespace-nowrap transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
