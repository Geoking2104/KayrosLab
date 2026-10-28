import { useState } from "react";
import { Button, Field, controlClass } from "./ui";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type ProfileSource = "crystal" | "linkedin";

const SOURCES: { id: ProfileSource; label: string; hint: string; logo: string; placeholder: string; color: string; alt: string }[] = [
  {
    id: "crystal",
    get label() { return t("Relier CrystalKnows"); },
    get hint() { return t("Adresse du profil public. Aucune fiche n’est téléchargée."); },
    logo: "brands/crystalknows.svg",
    placeholder: "https://www.crystalknows.com/p/…",
    color: "#01293D",
    alt: "CrystalKnows",
  },
  {
    id: "linkedin",
    get label() { return t("Relier le profil public LinkedIn"); },
    get hint() { return t("Adresse publique /in/. LinkedIn n’est pas visité."); },
    logo: "brands/linkedin.svg",
    placeholder: "https://www.linkedin.com/in/…",
    color: "#0A66C2",
    alt: "LinkedIn",
  },
];

function logoSrc(file: string) {
  return `${import.meta.env.BASE_URL}${file}`;
}

export function profileUrlOk(source: ProfileSource, raw: string) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (source === "linkedin") return host === "linkedin.com" && /^\/in\/[^/]+/i.test(url.pathname);
    return host === "crystalknows.com" && /^\/p\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function profileClue(source: ProfileSource, url: string) {
  return source === "crystal" ? t("Profil CrystalKnows {{url}}", {
    url
  }) : t("Profil public LinkedIn {{url}}", {
    url
  });
}

export function LinkedMark({ source, url, onChange }: { source: ProfileSource; url: string; onChange?: () => void }) {
  const item = SOURCES.find((entry) => entry.id === source) ?? SOURCES[0];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-3" style={{ borderLeft: `4px solid ${item.color}` }}>
      <img src={logoSrc(item.logo)} alt={item.alt} className={cn("h-8 max-w-[9rem] object-contain object-left", source === "linkedin" && "w-8")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{source === "crystal" ? t("Relié à CrystalKnows") : t("Relié à LinkedIn")}</p>
        <p className="truncate text-xs text-muted">{url}</p>
      </div>
      {onChange ? (
        <button type="button" className="shrink-0 text-sm font-semibold text-accent" onClick={onChange}>{t("Changer")}</button>
      ) : null}
    </div>
  );
}

export function ProfileLink({ onContinue }: { onContinue: (source: ProfileSource, url: string) => void }) {
  const [source, setSource] = useState<ProfileSource | null>(null);
  const [url, setUrl] = useState("");
  const picked = SOURCES.find((item) => item.id === source) ?? null;
  const ok = source ? profileUrlOk(source, url) : false;

  return (
    <div className="grid gap-4" data-profile-gate>
      <div>
        <h2 className="text-sm font-semibold text-ink">{t("Relier un profil avant la fiche")}</h2>
        <p className="mt-1 text-sm text-muted">{t(
          "Choisissez CrystalKnows ou le profil public LinkedIn. Sans ce lien, la fiche ne s’ouvre pas. L’adresse est un indice autorisé : elle n’est pas visitée."
        )}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SOURCES.map((item) => {
          const on = source === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSource(item.id);
                setUrl("");
              }}
              className={cn("rounded-xl border bg-white px-3 py-3 text-left", on ? "border-accent ring-2 ring-accent/30" : "border-line")}
              style={{ borderLeft: `4px solid ${item.color}` }}
              aria-pressed={on}
            >
              <img src={logoSrc(item.logo)} alt={item.alt} className={cn("h-8 max-w-full object-contain object-left", item.id === "linkedin" && "w-8")} />
              <span className="mt-3 block text-sm font-semibold text-ink">{item.label}</span>
              <span className="mt-1 block text-xs text-muted">{item.hint}</span>
            </button>
          );
        })}
      </div>
      {picked ? (
        <div className="grid gap-3">
          <Field label={t("Adresse du profil")} hint={picked.placeholder}>
            <input className={controlClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder={picked.placeholder} inputMode="url" autoComplete="url" aria-label={t("Adresse du profil")} />
          </Field>
          {url.trim() && !ok ? (
            <p className="text-sm text-stop" role="alert">{t("Adresse attendue :")}{" "}{picked.placeholder.replace("…", "nom")}
            </p>
          ) : null}
          <Button className="w-fit" disabled={!ok} onClick={() => source && onContinue(source, url.trim())}>{t("Continuer vers la fiche")}</Button>
        </div>
      ) : null}
    </div>
  );
}
