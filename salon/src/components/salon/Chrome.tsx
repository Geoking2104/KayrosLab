import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { bindLibrary } from "@/lib/salon/catalog";
import { useT } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import { loadSalonCore } from "@/lib/salon/wasm";
import "./salon.css";

export function SalonChrome({ children, current }: { children: ReactNode; current?: "foyer" | "seance" | "agents" }) {
  const setHydrated = useSalon((s) => s.setHydrated);
  const customs = useSalon((s) => s.customs);
  const extraWorks = useSalon((s) => s.extraWorks);
  const extraPassages = useSalon((s) => s.extraPassages);
  const { t, locale, setLocale } = useT();

  useEffect(() => {
    const api = useSalon.persist;
    const done = () => setHydrated(true);
    Promise.resolve(api.rehydrate()).then(done, done);
  }, [setHydrated]);

  useEffect(() => {
    bindLibrary({ customs, extraWorks, extraPassages });
  }, [customs, extraWorks, extraPassages]);

  useEffect(() => {
    void loadSalonCore();
  }, []);

  return (
    <div className="salon-root" lang={locale}>
      <header className="salon-masthead">
        <Link to="/salon" className="salon-wordmark">
          Salon
          <small>{t("wordmark.sub")}</small>
        </Link>
        <nav className="salon-nav" aria-label="Salon">
          <Link to="/salon" aria-current={current === "foyer" ? "page" : undefined}>
            {t("nav.circles")}
          </Link>
          <Link to="/salon/agents" aria-current={current === "agents" ? "page" : undefined}>
            {t("nav.agents")}
          </Link>
          <span className="salon-lang" role="group" aria-label="Language">
            <button type="button" className={locale === "fr" ? "is-on" : undefined} onClick={() => setLocale("fr")}>
              {t("lang.fr")}
            </button>
            <button type="button" className={locale === "en" ? "is-on" : undefined} onClick={() => setLocale("en")}>
              {t("lang.en")}
            </button>
          </span>
        </nav>
      </header>
      {children}
      <footer className="salon-foot">
        <p>{t("foot.line")}</p>
        <nav aria-label="Pied de Salon">
          <Link to="/salon/agents">{t("nav.agents")}</Link>
          <a href="mailto:contact@kayroslab.com">{t("contact")}</a>
        </nav>
      </footer>
    </div>
  );
}
