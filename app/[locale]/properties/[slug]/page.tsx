import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PropertyImage } from "@/components/property-image";
import { Link } from "@/i18n/navigation";
import { getNearby, getProperty, type PropertyDetail } from "@/lib/db/catalog";
import { propertyTitle } from "@/lib/format";
import { localeAlternates } from "@/lib/seo";

const NEARBY_KM = 10;

export async function generateMetadata({ params }: PageProps<"/[locale]/properties/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [t, locale, property] = await Promise.all([getTranslations(), getLocale(), getProperty(slug)]);
  if (!property) return { title: t("Errors.notFoundTitle") };
  const description = (property.translations[locale] ?? property.translations.en ?? "").slice(0, 155);
  return {
    title: propertyTitle(t, property),
    description: description || undefined,
    alternates: localeAlternates(locale, `/properties/${slug}`),
    robots: { index: false }, // synthetic listings should not compete with real ones in search engines
  };
}

export default async function PropertyPage({ params }: PageProps<"/[locale]/properties/[slug]">) {
  const t = await getTranslations("Search");
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8 text-ink-600" role="status">{t("loading")}</div>}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/[locale]/properties/[slug]">, "params">) {
  const { slug } = await params;
  const property = await getProperty(slug);
  if (!property) notFound();

  const [t, locale, format] = await Promise.all([getTranslations(), getLocale(), getFormatter()]);
  const title = propertyTitle(t, property);
  const description = property.translations[locale];
  const fallback = !description && property.translations.en ? property.translations.en : null;
  const price = format.number(property.priceEur, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const value = (v: number | null, render: (n: number) => string) => (v === null ? t("Property.unknown") : render(v));
  const facts: [string, string][] = [
    [t("Property.bedrooms"), value(property.bedrooms, String)],
    [t("Property.bathrooms"), value(property.bathrooms, String)],
    [t("Property.built"), value(property.livingAreaM2, (n) => t("Property.area", { area: n }))],
    [t("Property.plot"), value(property.plotAreaM2, (n) => t("Property.area", { area: n }))],
    [t("Property.pool"), property.hasPool ? t("Property.yes") : t("Property.no")],
    [t("Property.newBuild"), property.isNewBuild ? t("Property.yes") : t("Property.no")],
    [t("Property.energy"), property.energyRating ?? t("Property.unknown")],
    [t("Property.reference"), property.ref ?? t("Property.unknown")],
  ];

  return (
    <article className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/properties" className="text-sm text-sea-700 underline">← {t("Property.back")}</Link>
      <p className="mt-4 rounded-md bg-sand-100 px-3 py-2 text-sm text-ink-700">{t("Property.synthetic")}</p>

      <header className="mt-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-terracotta-700">
            {property.city}, {property.region} · {property.listingType === "rent" ? t("Property.forRent") : t("Property.forSale")}
          </p>
          <h1 className="mt-1 font-serif text-3xl text-ink-900 sm:text-4xl">{title}</h1>
        </div>
        <p className="text-3xl font-semibold text-ink-900">
          {price}
          {property.listingType === "rent" && <span className="text-base font-normal text-ink-500"> {t("Property.perMonth")}</span>}
        </p>
      </header>

      <Gallery property={property} title={title} />

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <section>
            <h2 className="font-serif text-2xl text-ink-900">{t("Property.description")}</h2>
            {fallback && <p className="mt-2 text-sm italic text-ink-500">{t("Property.fallbackNotice")}</p>}
            {/* Feed text is untrusted and rendered as plain text only. */}
            <p className="mt-3 whitespace-pre-line leading-relaxed text-ink-700" lang={description ? locale : "en"}>
              {description ?? fallback ?? t("Property.noDescription")}
            </p>
          </section>
          {property.features.length > 0 && (
            <section>
              <h2 className="font-serif text-2xl text-ink-900">{t("Property.features")}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {property.features.map((f) => (
                  <li key={f} className="rounded-full bg-sand-100 px-3 py-1 text-sm text-ink-700" lang="en">{f}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="font-serif text-2xl text-ink-900">{t("Property.location")}</h2>
            <p className="mt-3 text-ink-700">{property.city}, {property.region}</p>
            {property.latitude !== null && property.longitude !== null && (
              <p className="mt-1 text-sm text-ink-600">
                {t("Property.approximate", { lat: property.latitude.toFixed(3), lng: property.longitude.toFixed(3) })} ·{" "}
                <a
                  className="text-sea-700 underline"
                  href={`https://www.openstreetmap.org/?mlat=${property.latitude}&mlon=${property.longitude}#map=13/${property.latitude}/${property.longitude}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("Property.openMap")}
                </a>
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          <section className="rounded-lg border border-sand-200 bg-white p-4">
            <h2 className="font-serif text-lg text-ink-900">{t("Property.keyFacts")}</h2>
            <dl className="mt-3 divide-y divide-sand-200 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-ink-600">{k}</dt>
                  <dd className="text-right font-medium text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {property.latitude !== null && property.longitude !== null && (
            <Nearby lat={property.latitude} lng={property.longitude} slug={property.slug} />
          )}
        </aside>
      </div>
    </article>
  );
}

async function Gallery({ property, title }: { property: PropertyDetail; title: string }) {
  const t = await getTranslations("Property");
  const [main, ...rest] = property.images;
  return (
    <div className="mt-6 grid gap-2 md:grid-cols-[2fr_1fr]">
      <div className="overflow-hidden rounded-lg">
        <PropertyImage image={main ?? null} alt={`${title} · ${t("photo", { n: 1, total: property.images.length })}`} sizes="(min-width: 768px) 66vw, 100vw" priority noPhoto={t("noPhoto")} />
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {rest.slice(0, 2).map((img, i) => (
            <div key={img.ordinal} className="overflow-hidden rounded-lg">
              <PropertyImage image={img} alt={`${title} · ${t("photo", { n: i + 2, total: property.images.length })}`} sizes="(min-width: 768px) 33vw, 50vw" noPhoto={t("noPhoto")} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function Nearby({ lat, lng, slug }: { lat: number; lng: number; slug: string }) {
  const [t, format, nearby] = await Promise.all([getTranslations("Property"), getFormatter(), getNearby(lat, lng, NEARBY_KM, slug)]);
  return (
    <section className="rounded-lg border border-sand-200 bg-white p-4">
      <h2 className="font-serif text-lg text-ink-900">{t("nearby", { km: NEARBY_KM })}</h2>
      <p className="mt-1 text-xs text-ink-500">{t("nearbyNote")}</p>
      {nearby.length === 0 ? (
        <p className="mt-3 text-sm text-ink-600">{t("nearbyEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {nearby.map((n) => (
            <li key={n.slug} className="flex justify-between gap-2">
              <Link href={`/properties/${n.slug}`} className="text-sea-700 underline">
                {n.city} · {format.number(n.priceEur, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                {n.listingType === "rent" && ` ${t("perMonth")}`}
              </Link>
              <span className="text-ink-500">{t("distance", { km: n.distanceKm.toFixed(1) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
