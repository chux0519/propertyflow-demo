import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Fraunces, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LocaleSwitcher, LocaleSwitcherFallback } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Site");
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations("Site");

  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <NextIntlClientProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
            {t("skipToContent")}
          </a>
          <header className="border-b border-sand-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="font-serif text-xl font-semibold text-ink-900">
                {t("name")}
                <span className="ml-2 align-middle text-xs font-sans font-medium uppercase tracking-wide text-terracotta-700">demo</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm text-ink-700">
                <Link href="/properties" className="hover:text-ink-900 hover:underline">{t("nav.properties")}</Link>
                <Link href="/demo/pipeline" className="hover:text-ink-900 hover:underline">{t("nav.pipeline")}</Link>
                <Link href="/about-demo" className="hidden hover:text-ink-900 hover:underline sm:inline">{t("nav.about")}</Link>
                <Suspense fallback={<LocaleSwitcherFallback />}>
                  <LocaleSwitcher />
                </Suspense>
              </nav>
            </div>
          </header>
          <main id="main" className="flex-1">{children}</main>
          <footer className="border-t border-sand-200 bg-sand-100">
            <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-sm text-ink-600">
              <p className="font-medium text-ink-900">{t("footer.disclaimer")}</p>
              <p>{t("footer.data")}</p>
              <p>
                {t("footer.built")} · <Link href="/about-demo" className="underline">{t("nav.about")}</Link>
              </p>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
