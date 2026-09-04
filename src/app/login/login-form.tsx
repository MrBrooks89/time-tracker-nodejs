"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";

import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const demoAccounts = [
  { label: "Admin", email: "aaron.alvarez@hackathon.com" },
  { label: "Manager", email: "fatima.kim@hackathon.com" },
  { label: "Employee", email: "ana.bell@hackathon.com" },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    const { error } = await signIn.email({ email, password });

    if (error) {
      setError("Invalid email or password.");
      setIsPending(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="planner-bg flex flex-1 items-center justify-center overflow-hidden">
      <div className="container flex items-center justify-center px-4 py-12">
        <div className="glass-panel animate-scale-in flex w-full max-w-md flex-col gap-6 p-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="command-strip flex size-10 items-center justify-center rounded-full text-primary-foreground shadow-[0_10px_32px_-12px_var(--primary)]">
                <Clock className="size-5" />
              </span>
              <p className="micro-label">Time Tracking / Access Console</p>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-3xl font-bold tracking-tight">
                Sign in
              </h1>
              <p className="text-sm text-muted-foreground">
                Authenticate to reach your command deck and timesheets.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hackathon.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" aria-live="polite">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={isPending}>
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="blueprint-surface flex flex-col gap-2 p-4">
            <p className="micro-label">Demo Access</p>
            <p className="text-xs text-muted-foreground">
              Shared password: <span className="font-mono">hackathon2026</span>
            </p>
            <ul className="flex flex-col gap-1.5 font-mono text-xs text-muted-foreground">
              {demoAccounts.map((account) => (
                <li key={account.email}>
                  {account.label}: {account.email}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
