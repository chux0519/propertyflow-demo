import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Unprefixed paths such as /demo/pipeline redirect to their locale-prefixed version.
export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
