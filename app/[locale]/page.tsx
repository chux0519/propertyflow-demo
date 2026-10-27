import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PropertyCard } from "@/components/property-card";
import { Link } from "@/i18n/navigation";
import { getFacets, getLatestProperties } from "@/lib/db/catalog";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Home");
  return {
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
    alternates: localeAlternates(await getLocale(), "/"),
  };
}

export default async function HomePage() {
  const t = await getTranslations("Home");
  const locale = await getLocale();
  const [facets, latest] = await Promise.all([getFacets(), getLatestProperties(6)]);

  return (
    <>
      <section className="bg-gradient-to-b from-sand-100 to-sand-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm font-medium uppercase tracking-wide text-terracotta-700">{t("eyebrow")}</p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-tight text-ink-900 sm:text-5xl">{t("heroTitle")}</h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-700">{t("heroText", { count: facets.total })}</p>
          <form action={`/${locale}/properties`} method="get" className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="home-region">{t("quickSearch")}</label>
            <select id="home-region" name="region" className="flex-1 rounded-md border border-sand-300 bg-white px-3 py-3 text-ink-900">
              <option value="">{t("allRegions")}</option>
              {facets.regions.map((r) => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-terracotta-600 px-6 py-3 font-medium text-white hover:bg-terracotta-700">
              {t("search")}
            </button>
          </form>
          <p className="mt-4 text-sm">
            <Link href="/demo/pipeline" className="text-sea-700 underline">{t("seePipeline")} →</Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl text-ink-900">{t("latest")}</h2>
          <Link href="/properties" className="text-sm text-sea-700 underline">{t("viewAll")}</Link>
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((p, i) => (
            <PropertyCard key={p.slug} property={p} priority={i < 3} />
          ))}
        </div>
      </section>

      <section className="border-t border-sand-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
          {(["import", "data", "i18n"] as const).map((key) => (
            <div key={key}>
              <h3 className="font-serif text-lg text-ink-900">{t(`pillars.${key}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{t(`pillars.${key}Text`)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
