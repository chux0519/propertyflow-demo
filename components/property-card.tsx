import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { PropertyCard as Card } from "@/lib/db/catalog";
import { propertyTitle } from "@/lib/format";
import { PropertyImage } from "./property-image";

export function PropertyCard({ property, priority = false }: { property: Card; priority?: boolean }) {
  const t = useTranslations();
  const format = useFormatter();
  const title = propertyTitle(t, property);
  const price = format.number(property.priceEur, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <article className="group overflow-hidden rounded-lg border border-sand-200 bg-white shadow-sm transition hover:shadow-md">
      <Link href={`/properties/${property.slug}`} className="block focus-visible:outline-none">
        <PropertyImage
          image={property.image}
          alt={title}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          priority={priority}
          noPhoto={t("Property.noPhoto")}
        />
        <div className="space-y-2 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-terracotta-700">
            {property.region} · {property.listingType === "rent" ? t("Property.forRent") : t("Property.forSale")}
          </p>
          <h3 className="font-serif text-lg leading-snug text-ink-900 group-hover:underline">{title}</h3>
          <p className="text-xl font-semibold text-ink-900">
            {price}
            {property.listingType === "rent" && <span className="text-sm font-normal text-ink-500"> {t("Property.perMonth")}</span>}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-600">
            {property.bedrooms !== null && <li>{t("Property.beds", { count: property.bedrooms })}</li>}
            {property.bathrooms !== null && <li>{t("Property.baths", { count: property.bathrooms })}</li>}
            {property.livingAreaM2 !== null && <li>{t("Property.area", { area: property.livingAreaM2 })}</li>}
            {property.hasPool && <li>{t("Property.pool")}</li>}
          </ul>
        </div>
      </Link>
    </article>
  );
}
