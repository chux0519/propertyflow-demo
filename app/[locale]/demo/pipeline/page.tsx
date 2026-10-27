import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { getImportRuns, type ImportRun } from "@/lib/db/catalog";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pipeline");
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: localeAlternates(await getLocale(), "/demo/pipeline") };
}

const statusStyle: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILED: "bg-red-50 text-red-800 ring-red-200",
};

export default async function PipelinePage() {
  const [t, format, runs] = await Promise.all([getTranslations("Pipeline"), getFormatter(), getImportRuns(20)]);
  const latest = runs[0];
  const lastSuccess = runs.find((r) => r.status === "COMPLETED");
  const statusLabel = (s: string) =>
    s === "COMPLETED" ? t("statusCOMPLETED") : s === "FAILED" ? t("statusFAILED") : t("statusRUNNING");
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const duration = (r: ImportRun) =>
    r.finishedAt ? `${((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(1)} s` : "–";
  const badge = (s: string) => (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle[s] ?? "bg-amber-50 text-amber-800 ring-amber-200"}`}>
      {statusLabel(s)}
    </span>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <p className="inline-block rounded bg-terracotta-600 px-2 py-1 text-xs font-bold tracking-widest text-white">{t("badge")}</p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900">{t("title")}</h1>
      <p className="mt-3 max-w-3xl text-ink-700">{t("intro")}</p>
      <p className="mt-2 max-w-3xl text-sm text-ink-600">{t("simulator")}</p>

      {!latest ? (
        <p className="mt-8 text-ink-600">{t("noRuns")}</p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[{ label: t("lastRun"), run: latest }, ...(lastSuccess ? [{ label: t("lastSuccess"), run: lastSuccess }] : [])].map(({ label, run }) => (
              <section key={label} className="rounded-lg border border-sand-200 bg-white p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-serif text-lg text-ink-900">{label} · #{run.id}</h2>
                  {badge(run.status)}
                </div>
                <p className="mt-1 text-sm text-ink-600">{when(run.startedAt)} · {duration(run)}</p>
                <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                  {([["inserted", run.inserted], ["updated", run.updated], ["unchanged", run.unchanged], ["errors", run.errors]] as const).map(([k, v]) => (
                    <div key={k} className="rounded-md bg-sand-50 p-2">
                      <dt className="text-xs text-ink-600">{t(k)}</dt>
                      <dd className="text-xl font-semibold text-ink-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                {run.summary && <p className="mt-3 text-sm text-ink-700">{run.summary}</p>}
              </section>
            ))}
          </div>

          <section className="mt-10">
            <h2 className="font-serif text-2xl text-ink-900">{t("recentRuns")}</h2>
            <div className="mt-4 overflow-x-auto rounded-lg border border-sand-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-sand-100 text-left text-ink-700">
                  <tr>
                    {(["run", "started", "duration", "status", "records", "inserted", "updated", "unchanged", "errors", "removals", "deactivated", "summary"] as const).map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{t(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-200">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono">#{r.id}</td>
                      <td className="whitespace-nowrap px-3 py-2">{when(r.startedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{duration(r)}</td>
                      <td className="px-3 py-2">{badge(r.status)}</td>
                      <td className="px-3 py-2 text-right">{r.feedRecordCount ?? "–"}</td>
                      <td className="px-3 py-2 text-right">{r.inserted}</td>
                      <td className="px-3 py-2 text-right">{r.updated}</td>
                      <td className="px-3 py-2 text-right">{r.unchanged}</td>
                      <td className="px-3 py-2 text-right">{r.errors}</td>
                      <td className="px-3 py-2 text-right">{r.removalPreview}</td>
                      <td className="px-3 py-2 text-right">{r.deactivated}</td>
                      <td className="min-w-64 px-3 py-2 text-ink-600">{r.summary ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="mt-10 max-w-3xl">
        <h2 className="font-serif text-2xl text-ink-900">{t("howTitle")}</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink-700">
          {(["fetch", "parse", "upsert", "guard", "lock"] as const).map((k) => (
            <li key={k}>{t(`how.${k}`)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
