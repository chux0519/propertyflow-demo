import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { filtersToQuery, type SearchFilters } from "@/lib/search/filters";

export function Pagination({ filters, pages }: { filters: SearchFilters; pages: number }) {
  const t = useTranslations("Search");
  if (pages <= 1) return null;
  const link = (page: number) => `/properties${filtersToQuery({ ...filters, page })}`;
  const btn = "rounded-md border border-sand-300 bg-white px-4 py-2 text-sm";
  return (
    <nav className="mt-8 flex items-center justify-between" aria-label="Pagination">
      {filters.page > 1 ? <Link href={link(filters.page - 1)} className={btn} rel="prev">{t("previous")}</Link> : <span />}
      <span className="text-sm text-ink-600">{t("pageOf", { page: filters.page, pages })}</span>
      {filters.page < pages ? <Link href={link(filters.page + 1)} className={btn} rel="next">{t("next")}</Link> : <span />}
    </nav>
  );
}
