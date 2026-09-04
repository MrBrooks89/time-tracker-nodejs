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
    allowedHosts: ["localhost:3000", "192.168.4.112:3000"],
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
    cookieCache: {
      enabled: true,
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
