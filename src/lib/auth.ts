import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import { db } from "../db/index.ts";
import { account, session, user, verification } from "../db/schema.ts";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "dev-only-secret-change-me-in-production-0123456789",
  // Dynamic baseURL: accepts requests from any of the allowed hosts and derives
  // the request-specific base URL from the incoming Host header. Entries are
  // automatically added to trustedOrigins, so sign-in from the LAN IP passes the
  // origin check. Explicit protocol keeps cookies non-Secure in dev (plain HTTP).
  // Set explicitly (never via the BETTER_AUTH_URL env var) so stray .env values
  // cannot override the allowlist. Add the production domain when deploying.
  baseURL: {
    allowedHosts: ["localhost:3000", "192.168.*.*:3000"],
    protocol: process.env.NODE_ENV === "development" ? "http" : "https",
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "employee",
        input: false,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  session: {
    // NF-005 session inactivity expiry: 30-minute window, extended on
    // activity. Verified against better-auth 1.7.2 source: session refresh
    // fires when remaining lifetime <= expiresIn - updateAge
    // (dist/api/routes/session.mjs), and the default updateAge is 24h
    // (dist/context/create-context.mjs: 1440 * 60). With a 30-min expiresIn
    // and that default, refresh would never fire and active users would be
    // dropped mid-session — so updateAge is tuned to 60s, keeping active
    // sessions rolling while idle sessions hard-expire 30 minutes after the
    // last request.
    expiresIn: 60 * 30,
    updateAge: 60,
    cookieCache: {
      enabled: true,
      // <= expiresIn: the cache cookie dies with (or before) the session, and
      // better-auth re-checks expiresAt on every cache hit
      // (dist/api/routes/session.mjs), so an expired session is never served
      // from cache.
      maxAge: 5 * 60,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [row] = await db
            .select({ isActive: user.isActive })
            .from(user)
            .where(eq(user.id, session.userId))
            .limit(1);
          if (!row || row.isActive === false) return false;
        },
      },
    },
  },
});

export type Auth = typeof auth;
