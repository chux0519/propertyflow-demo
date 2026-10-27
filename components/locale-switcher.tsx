"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("Site");
  const current = useLocale();
  const pathname = usePathname();
  const query = Object.fromEntries(useSearchParams());

  return (
    <nav aria-label={t("language")} className="flex items-center gap-1 text-sm">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={{ pathname, query }}
          locale={locale}
          aria-current={locale === current ? "true" : undefined}
          className={`rounded px-2 py-1 uppercase ${locale === current ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-sand-200"}`}
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}

export function LocaleSwitcherFallback() {
  return <div className="h-7 w-20" aria-hidden />;
}
