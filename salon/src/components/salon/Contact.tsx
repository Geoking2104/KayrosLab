import { useState, type FormEvent } from "react";
import { useT, type Locale, type MsgKey } from "@/lib/salon/i18n";
import { SalonChrome } from "./Chrome";

const API = "https://api.kayroslab.com";
const CONTACT_EXT = /\.(pdf|png|jpe?g|gif|webp|txt|md|csv|log|json)$/i;

function mailtoOf(kind: "message" | "bug", locale: Locale, payload: { name: string; email: string; subject: string; message: string }) {
  const label = kind === "bug" ? (locale === "en" ? "Report" : "Signalement") : locale === "en" ? "Letter" : "Lettre";
  const subject = `[KayrosLab] ${label} — ${payload.name}${payload.subject ? ` — ${payload.subject}` : ""}`;
  const body = [`Nom : ${payload.name}`, `E-mail : ${payload.email}`, payload.subject ? `Objet : ${payload.subject}` : "", "", payload.message]
    .filter((line, i, a) => line || (i && a[i - 1]))
    .join("\n");
  return `mailto:contact@kayroslab.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function errorKey(res: Response, body: { code?: string } | null): MsgKey {
  const code = body?.code;
  if (code === "RATE" || res.status === 429) return "contact.err.rate";
  if (code === "FILE") return "contact.err.files.type";
  if (code === "INVALID" || res.status === 400) return "contact.err.invalid";
  if (code === "SMTP_UNCONFIGURED" || code === "SMTP" || res.status === 503 || res.status === 502) return "contact.err.smtp";
  return "contact.fail";
}

async function filesOf(list: FileList | null) {
  const files = [...(list ?? [])];
  if (files.length > 3) throw new Error("contact.err.files.count");
  return Promise.all(
    files.map(
      (file) =>
        new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
          if (file.size > 2 * 1024 * 1024) {
            reject(new Error("contact.err.files.size"));
            return;
          }
          if (!CONTACT_EXT.test(file.name)) {
            reject(new Error("contact.err.files.type"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result || "") });
          reader.onerror = () => reject(new Error("contact.err.files.type"));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function LetterForm({ kind }: { kind: "message" | "bug" }) {
  const { t, locale } = useT();
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"idle" | "ok" | "err" | "busy">("idle");
  const [mailto, setMailto] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      kind,
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      subject: String(data.get("subject") || "").trim(),
      message: String(data.get("message") || "").trim(),
      website: String(data.get("website") || ""),
      language: locale,
      files: [] as { name: string; type: string; data: string }[],
    };
    setMailto("");
    if (!payload.name) {
      setTone("err");
      setStatus(t("contact.err.name"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setTone("err");
      setStatus(t("contact.err.email"));
      return;
    }
    if (payload.message.length < 8) {
      setTone("err");
      setStatus(t("contact.err.message"));
      return;
    }
    setBusy(true);
    setTone("busy");
    setStatus(t("contact.busy"));
    try {
      payload.files = kind === "bug" ? await filesOf(form.querySelector<HTMLInputElement>('input[type="file"]')?.files ?? null) : [];
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch(`${API}/v1/contact`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        window.clearTimeout(timer);
      }
      let body: { code?: string } | null = null;
      try {
        body = (await res.json()) as { code?: string };
      } catch {
        body = null;
      }
      if (res.ok) {
        setTone("ok");
        setStatus(t("contact.sent"));
        form.reset();
        return;
      }
      const key = errorKey(res, body);
      setTone("err");
      setStatus(t(key));
      if (key === "contact.err.smtp" || key === "contact.fail") setMailto(mailtoOf(kind, locale, payload));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.startsWith("contact.err.")) {
        setTone("err");
        setStatus(t(raw as MsgKey));
        return;
      }
      const timeout = err instanceof Error && err.name === "AbortError";
      setTone("err");
      setStatus(t(timeout ? "contact.err.timeout" : "contact.err.network"));
      setMailto(mailtoOf(kind, locale, payload));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={"salon-contact-form" + (tone === "err" ? " is-err" : "")} onSubmit={onSubmit} noValidate>
      <h2>{t(kind === "bug" ? "contact.bug" : "contact.letter")}</h2>
      <label>
        {t("contact.name")}
        <input name="name" required maxLength={120} autoComplete="name" />
      </label>
      <label>
        {t("contact.email")}
        <input name="email" type="email" required maxLength={254} autoComplete="email" />
      </label>
      <label>
        {t("contact.subject")}
        <input name="subject" maxLength={180} />
      </label>
      <label>
        {t(kind === "bug" ? "contact.remark" : "contact.message")}
        <textarea name="message" required minLength={8} maxLength={8000} rows={6} />
      </label>
      {kind === "bug" ? (
        <>
          <label>
            {t("contact.files")}
            <input
              name="files"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.log,.json,application/pdf,image/*,text/plain"
            />
          </label>
          <p className="salon-how">{t("contact.files.help")}</p>
        </>
      ) : null}
      <input name="website" className="salon-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <p className={"salon-contact-status" + (tone === "err" ? " is-err" : tone === "ok" ? " is-ok" : "")} role="alert" aria-live="polite">
        {status}
      </p>
      {mailto ? (
        <p className="salon-contact-mail">
          <a href={mailto}>{t("contact.mailto")}</a>
        </p>
      ) : null}
      <button className="salon-btn" type="submit" disabled={busy}>
        {t("contact.send")}
      </button>
    </form>
  );
}

export function Contact() {
  const { t } = useT();
  return (
    <SalonChrome current="contact">
      <main className="salon-stage">
        <section className="salon-hero">
          <p className="salon-kicker">{t("contact.kicker")}</p>
          <h1>{t("contact.h1")}</h1>
          <p>{t("contact.lead")}</p>
          <p>
            <a href="mailto:contact@kayroslab.com">contact@kayroslab.com</a>
          </p>
        </section>
        <div className="salon-contact-pair">
          <LetterForm kind="message" />
          <LetterForm kind="bug" />
        </div>
      </main>
    </SalonChrome>
  );
}
