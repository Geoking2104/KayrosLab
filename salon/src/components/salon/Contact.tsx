import { useState, type FormEvent } from "react";
import { useT } from "@/lib/salon/i18n";
import { SalonChrome } from "./Chrome";

const API = "https://api.kayroslab.com";

async function filesOf(list: FileList | null) {
  const files = [...(list ?? [])].slice(0, 3);
  return Promise.all(
    files.map(
      (file) =>
        new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
          if (file.size > 2 * 1024 * 1024) {
            reject(new Error("size"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result || "") });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function LetterForm({ kind }: { kind: "message" | "bug" }) {
  const { t, locale } = useT();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setStatus(t("contact.busy"));
    try {
      const files = kind === "bug" ? await filesOf(form.querySelector<HTMLInputElement>('input[type="file"]')?.files ?? null) : [];
      const res = await fetch(`${API}/v1/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim(),
          subject: String(data.get("subject") || "").trim(),
          message: String(data.get("message") || "").trim(),
          website: String(data.get("website") || ""),
          language: locale,
          files,
        }),
      });
      if (!res.ok) throw new Error("http");
      setStatus(t("contact.sent"));
      form.reset();
    } catch {
      setStatus(t("contact.fail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="salon-contact-form" onSubmit={onSubmit}>
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
      <p className="salon-contact-status" role="status">
        {status}
      </p>
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
        </section>
        <div className="salon-contact-pair">
          <LetterForm kind="message" />
          <LetterForm kind="bug" />
        </div>
      </main>
    </SalonChrome>
  );
}
