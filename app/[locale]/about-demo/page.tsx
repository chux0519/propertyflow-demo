import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";

const REPO_URL = "https://github.com/chux0519/propertyflow-demo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("About");
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: localeAlternates(await getLocale(), "/about-demo") };
}

export default async function AboutPage() {
  const t = await getTranslations("About");
  const lists = [
    { title: t("realTitle"), items: t.raw("real") as string[], tone: "border-emerald-300" },
    { title: t("simulatedTitle"), items: t.raw("simulated") as string[], tone: "border-amber-300" },
    { title: t("notTitle"), items: t.raw("not") as string[], tone: "border-red-300" },
  ];
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-serif text-3xl text-ink-900">{t("title")}</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-700">{t("intro")}</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {lists.map((l) => (
          <section key={l.title} className={`rounded-lg border-t-4 bg-white p-4 shadow-sm ${l.tone}`}>
            <h2 className="font-serif text-lg text-ink-900">{l.title}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-700">
              {l.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="font-serif text-2xl text-ink-900">{t("archTitle")}</h2>
        <p className="mt-3 rounded-lg bg-white p-4 font-mono text-sm leading-relaxed text-ink-700">{t("arch")}</p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl text-ink-900">{t("sourceTitle")}</h2>
        <p className="mt-3 text-ink-700">{t("source")}</p>
        <p className="mt-2"><a href={REPO_URL} className="text-sea-700 underline" rel="noopener noreferrer">{REPO_URL.replace("https://", "")}</a></p>
        <p className="mt-4 text-sm text-ink-600">
          {t("kyero")}{" "}
          <a href="https://help.kyero.com/estate-agents/xml-import-specification" className="underline" rel="noopener noreferrer">help.kyero.com</a>
        </p>
      </section>
    </div>
  );
}
