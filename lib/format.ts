import type { PropertyCard } from "@/lib/db/catalog";

const KNOWN_TYPES = ["villa", "apartment", "townhouse", "penthouse", "finca", "bungalow"] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

// Accepts the root (un-namespaced) translator from useTranslations()/getTranslations().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = (key: any, values?: any) => string;

export function typeLabel(t: T, type: string): string {
  return (KNOWN_TYPES as readonly string[]).includes(type) ? t(`Types.${type as KnownType}`) : t("Types.other");
}

/** Titles are composed per locale from structured fields, so they never need translating. */
export function propertyTitle(t: T, p: Pick<PropertyCard, "propertyType" | "bedrooms" | "city">): string {
  const type = typeLabel(t, p.propertyType);
  return p.bedrooms
    ? t("Property.title", { type, beds: p.bedrooms, city: p.city })
    : t("Property.titleNoBeds", { type, city: p.city });
}
