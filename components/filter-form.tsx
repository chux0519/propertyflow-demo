import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Facets } from "@/lib/db/catalog";
import { typeLabel } from "@/lib/format";
import type { SearchFilters } from "@/lib/search/filters";
import { FilterDrawer } from "./filter-drawer";

const field = "mt-1 block w-full rounded-md border border-sand-300 bg-white px-3 py-2 text-sm text-ink-900";
const labelCls = "block text-sm font-medium text-ink-700";

// A plain GET form: filters live in the URL, work without JavaScript and survive refresh/sharing.
export function FilterForm({ filters, facets }: { filters: SearchFilters; facets: Facets }) {
  const t = useTranslations();
  return (
    <FilterDrawer label={t("Search.showFilters")}>
      <form method="get" className="space-y-4 rounded-lg border border-sand-200 bg-white p-4" aria-label={t("Search.filters")}>
        <fieldset>
          <legend className={labelCls}>{t("Search.listing")}</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["sale", "rent"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 rounded-md border border-sand-300 px-3 py-2 text-sm has-[:checked]:border-terracotta-600 has-[:checked]:bg-terracotta-50">
                <input type="radio" name="listing" value={value} defaultChecked={filters.listing === value} />
                {t(`Search.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={labelCls}>
          {t("Search.region")}
          <select name="region" defaultValue={filters.region ?? ""} className={field}>
            <option value="">{t("Search.anyRegion")}</option>
            {facets.regions.map((r) => (
              <option key={r.name} value={r.name}>{r.name} ({r.count})</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          {t("Search.type")}
          <select name="type" defaultValue={filters.type ?? ""} className={field}>
            <option value="">{t("Search.anyType")}</option>
            {facets.types.map((type) => (
              <option key={type} value={type}>{typeLabel(t, type)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            {t("Search.minPrice")}
            <input type="number" name="minPrice" min={0} step={1000} inputMode="numeric" defaultValue={filters.minPrice} className={field} />
          </label>
          <label className={labelCls}>
            {t("Search.maxPrice")}
            <input type="number" name="maxPrice" min={0} step={1000} inputMode="numeric" defaultValue={filters.maxPrice} className={field} />
          </label>
        </div>
        <label className={labelCls}>
          {t("Search.minBeds")}
          <select name="minBeds" defaultValue={filters.minBeds ?? ""} className={field}>
            <option value="">{t("Search.any")}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="flex-1 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700">
            {t("Search.apply")}
          </button>
          <Link href="/properties" className="text-sm text-ink-600 underline">{t("Search.reset")}</Link>
        </div>
      </form>
    </FilterDrawer>
  );
}
