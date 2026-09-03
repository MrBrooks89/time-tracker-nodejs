import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-10 w-full cursor-pointer appearance-none rounded-xl border border-border bg-secondary/50 px-3.5 pr-10 text-sm text-foreground shadow-[inset_0_2px_4px_rgba(0,0,0,0.14)] outline-none transition-[box-shadow,border-color] focus-visible:border-ring/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
