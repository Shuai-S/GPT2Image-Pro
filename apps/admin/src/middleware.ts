import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  const pathnameWithoutLocale = pathname.replace(/^\/(en|zh)/, "") || "/";

  const protectedRoutes = ["/dashboard"];
  const authRoutes = ["/sign-in"];

  const isProtectedRoute = protectedRoutes.some(
    (route) =>
      pathnameWithoutLocale === route ||
      pathnameWithoutLocale.startsWith(`${route}/`)
  );

  const isAuthRoute = authRoutes.some(
    (route) => pathnameWithoutLocale === route
  );

  const localeMatch = pathname.match(/^\/(en|zh)/);
  const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;

  if (isProtectedRoute && !sessionToken) {
    const signInUrl = new URL(`/${locale}/sign-in`, request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (isAuthRoute && sessionToken) {
    return NextResponse.redirect(
      new URL(`/${locale}/dashboard`, request.url)
    );
  }

  if (pathnameWithoutLocale === "/" || pathnameWithoutLocale === "") {
    if (sessionToken) {
      return NextResponse.redirect(
        new URL(`/${locale}/dashboard`, request.url)
      );
    }
    return NextResponse.redirect(
      new URL(`/${locale}/sign-in`, request.url)
    );
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
