import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

import type { auth } from "./auth";

export const authClient = createAuthClient({
  // No baseURL: the auth server runs on the same origin as the client, so the
  // client defaults to window.location.origin. This keeps requests working when
  // the app is reached via localhost, a LAN IP, or a production domain.
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
