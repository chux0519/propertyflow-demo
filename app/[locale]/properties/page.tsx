import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FilterForm } from "@/components/filter-form";
import { Pagination } from "@/components/pagination";
import { PropertyCard } from "@/components/property-card";
import { getFacets, searchProperties } from "@/lib/db/catalog";
import { PAGE_SIZE, parseFilters } from "@/lib/search/filters";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Search");
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: localeAlternates(await getLocale(), "/properties") };
}

export default async function PropertiesPage({ searchParams }: PageProps<"/[locale]/properties">) {
  const t = await getTranslations("Search");
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-serif text-3xl text-ink-900">{t("title")}</h1>
      <Suspense fallback={<p className="mt-8 text-ink-600" role="status">{t("loading")}</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/[locale]/properties">, "searchParams">) {
  const t = await getTranslations("Search");
  const { filters, invalid } = parseFilters(await searchParams);
  const [facets, { items, total }] = await Promise.all([getFacets(), searchProperties(filters)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_1fr]">
      <aside>
        <FilterForm filters={filters} facets={facets} />
      </aside>
      <section aria-live="polite">
        <p className="text-sm text-ink-600">{t("results", { count: total })}</p>
        {invalid && <p className="mt-2 rounded-md bg-terracotta-50 px-3 py-2 text-sm text-terracotta-700">{t("ignored")}</p>}
        {items.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-sand-300 bg-white p-8 text-center">
            <p className="font-medium text-ink-900">{t("empty")}</p>
            <p className="mt-1 text-sm text-ink-600">{t("emptyHint")}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p, i) => (
              <PropertyCard key={p.slug} property={p} priority={i < 3} />
            ))}
          </div>
        )}
        <Pagination filters={filters} pages={pages} />
      </section>
    </div>
  );
}
