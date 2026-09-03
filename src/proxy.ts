import { NextResponse, type NextRequest } from "next/server";
import type { ProxyConfig } from "next/server";

const SESSION_COOKIE_NAMES: Array<string> = [
  "better-auth.session_token",
  "better-auth.session_data",
  "better-auth-session_token",
  "better-auth-session_data",
];

const FILE_EXTENSIONS: Array<string> = [
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".txt",
  ".xml",
  ".webmanifest",
  ".css",
  ".js",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
];

function isFile(pathname: string) {
  return FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function isAuthEndpoint(pathname: string) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

function isPublic(pathname: string) {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (isAuthEndpoint(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (isFile(pathname)) return true;
  return false;
}

function hasSessionCookie(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return false;
  return SESSION_COOKIE_NAMES.some((name) =>
    request.cookies.has(name) ||
    cookieHeader
      .split(";")
      .some((part) => part.trim().startsWith(name + "=")),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isPublic(pathname) && !hasSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config: ProxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
