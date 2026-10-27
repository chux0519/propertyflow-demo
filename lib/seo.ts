import type { Metadata } from "next";
import { routing, type Locale } from "@/i18n/routing";

/** canonical + hreflang alternates for a locale-independent path such as "/properties". */
export function localeAlternates(locale: Locale, path: string): Metadata["alternates"] {
  const suffix = path === "/" ? "" : path;
  return {
    canonical: `/${locale}${suffix}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${suffix}`])),
      "x-default": `/${routing.defaultLocale}${suffix}`,
    },
  };
}
