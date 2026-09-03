"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="planner-bg flex min-h-screen flex-1 items-center justify-center overflow-hidden">
      <div className="paper-card animate-scale-in flex w-full max-w-md flex-col gap-4 p-8 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred. Try again."}
        </p>
        <Button variant="destructive" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
