"use client";

import { useTranslations } from "next-intl";

// Never shows error details to visitors; they are in the server logs.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("Errors");
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="font-serif text-3xl text-ink-900">{t("errorTitle")}</h1>
      <p className="mt-3 text-ink-600">{t("errorText")}</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-ink-900 px-4 py-2 text-white">{t("retry")}</button>
    </div>
  );
}
