import { useState, type FormEvent } from "react";
import { SALON_API } from "@/lib/salon/sso";

export function OpenWhatsApp({ locale, circleId = "lumieres", question }: { locale: "fr" | "en"; circleId?: string; question?: string }) {
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = locale === "en"
    ? {
        kicker: "WhatsApp channel",
        title: "Open the table on WhatsApp",
        lead: "One number, several voices. Lumières opens as a chat with The Salon. Opt-in required.",
        phone: "Number",
        consent: "I agree to receive the invitation and Salon messages on WhatsApp.",
        submit: "Open Lumières",
        pending: "Request kept. The professional number is not public yet.",
        sent: "Invitation sent. You can also open the thread.",
        armed: "WhatsApp account still unarmed. The thread opens; voices will follow once the number is linked.",
        fail: "The table could not open.",
      }
    : {
        kicker: "Canal WhatsApp",
        title: "Ouvrir la table sur WhatsApp",
        lead: "Un numéro, plusieurs voix. Lumières s’ouvre en conversation avec Le Salon. Opt-in requis.",
        phone: "Numéro",
        consent: "J’accepte de recevoir le lien d’invitation et les messages du Salon sur WhatsApp.",
        submit: "Ouvrir Lumières",
        pending: "Demande enregistrée. Le numéro professionnel n’est pas encore public.",
        sent: "Invitation partie. Vous pouvez aussi ouvrir le fil.",
        armed: "Compte WhatsApp encore à armer. Le fil s’ouvre ; les voix arriveront dès que le numéro sera relié.",
        fail: "La table n’a pas pu s’ouvrir.",
      };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`${SALON_API}/v1/salon/whatsapp/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optIn,
          e164: phone,
          circleId,
          question: question || "Que reste-t-il de la liberté une fois qu’on a tout expliqué ?",
          locale,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || copy.fail);
      if (json.waMe) {
        setStatus(json.sent ? copy.sent : copy.armed);
        window.open(json.waMe, "_blank", "noopener");
      } else {
        setStatus(`${copy.pending} · ${json.last4 || ""}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.fail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="peau-steps" aria-labelledby="wa-open-titre">
      <p className="salon-kicker">{copy.kicker}</p>
      <h2 id="wa-open-titre">{copy.title}</h2>
      <p>{copy.lead}</p>
      <form onSubmit={onSubmit} className="salon-create" style={{ marginTop: "0.75rem" }}>
        <label>
          {copy.phone}
          <input type="tel" required autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33 6 …" />
        </label>
        <label className="salon-guest-pick" style={{ maxHeight: "none", border: 0, padding: 0 }}>
          <span>
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} required />
            {copy.consent}
          </span>
        </label>
        <button className="salon-btn" type="submit" disabled={busy || !optIn}>
          {copy.submit}
        </button>
        {status ? <p className="salon-form-error">{status}</p> : null}
      </form>
    </section>
  );
}
