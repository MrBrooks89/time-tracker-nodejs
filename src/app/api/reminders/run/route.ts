import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { maybeRunScheduledReminders } from "@/lib/reminders";
import { getSessionUser } from "@/lib/session";

// D7: external cron entry point for the deadline-day scheduled reminders.
// Runs the same idempotent maybeRunScheduledReminders() the app layout
// triggers lazily — safe to call repeatedly (one scheduled send per
// recipient per deadline day).
//
// Auth: an admin session, OR the CRON_SECRET request header when the secret
// is configured (Authorization: Bearer <secret> or x-cron-secret: <secret>).
// With no secret set and no admin session the route answers 401.

function secretMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function isAuthorized(): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const headerList = await headers();
    const authorization = headerList.get("authorization");
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    const provided = bearer ?? headerList.get("x-cron-secret");
    if (provided !== null && secretMatches(provided, secret)) {
      return true;
    }
  }

  const viewer = await getSessionUser();
  return viewer !== null && viewer.role === "admin";
}

async function handle() {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await maybeRunScheduledReminders();
  if (result.error) {
    return NextResponse.json(
      { ...result, error: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json(result);
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
