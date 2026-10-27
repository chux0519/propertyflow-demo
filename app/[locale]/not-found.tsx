import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("Errors");
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="font-serif text-3xl text-ink-900">{t("notFoundTitle")}</h1>
      <p className="mt-3 text-ink-600">{t("notFoundText")}</p>
      <Link href="/" className="mt-6 inline-block rounded-md bg-ink-900 px-4 py-2 text-white">{t("home")}</Link>
    </div>
  );
}
