import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — Time Tracker",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return <LoginForm />;
}
