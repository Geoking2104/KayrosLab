import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { bindLibrary } from "@/lib/salon/catalog";
import { useT } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import { loadSalonCore } from "@/lib/salon/wasm";
import {
  consumeSalonCallback,
  fetchSalonState,
  putSalonState,
  restoreSalonUser,
  signOutSalon,
  startSalonSso,
} from "@/lib/salon/sso";
import "./salon.css";

export function SalonChrome({ children, current }: { children: ReactNode; current?: "foyer" | "seance" | "agents" }) {
  const setHydrated = useSalon((s) => s.setHydrated);
  const customs = useSalon((s) => s.customs);
  const extraWorks = useSalon((s) => s.extraWorks);
  const extraPassages = useSalon((s) => s.extraPassages);
  const user = useSalon((s) => s.user);
  const setUser = useSalon((s) => s.setUser);
  const applyRemote = useSalon((s) => s.applyRemote);
  const snapshot = useSalon((s) => s.snapshot);
  const rooms = useSalon((s) => s.rooms);
  const patches = useSalon((s) => s.patches);
  const locale = useSalon((s) => s.locale);
  const { t, setLocale } = useT();
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const api = useSalon.persist;
    const done = () => setHydrated(true);
    let cancelled = false;
    Promise.resolve(api.rehydrate())
      .then(async () => {
        try {
          const fromCallback = await consumeSalonCallback();
          const session = fromCallback ?? (await restoreSalonUser());
          if (cancelled) return;
          setUser(session);
          if (session) {
            const remote = await fetchSalonState();
            if (!cancelled && remote) applyRemote(remote);
            if (fromCallback) await putSalonState(useSalon.getState().snapshot());
          }
        } catch (error) {
          if (!cancelled) setAuthError(error instanceof Error ? error.message : t("auth.error"));
        } finally {
          if (!cancelled) done();
        }
      })
      .catch(done);
    return () => {
      cancelled = true;
    };
  }, [applyRemote, setHydrated, setUser, t]);

  useEffect(() => {
    bindLibrary({ customs, extraWorks, extraPassages });
  }, [customs, extraWorks, extraPassages]);

  useEffect(() => {
    void loadSalonCore();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("doc.title");
  }, [locale, t]);

  useEffect(() => {
    if (!user) return;
    const handle = window.setTimeout(() => {
      void putSalonState(snapshot()).catch(() => {});
    }, 900);
    return () => window.clearTimeout(handle);
  }, [user, rooms, patches, locale, customs, extraWorks, extraPassages, snapshot]);

  async function onAuth() {
    setAuthError("");
    setAuthBusy(true);
    try {
      if (user) {
        await signOutSalon();
        setUser(null);
        return;
      }
      await startSalonSso();
    } catch {
      setAuthError(t("auth.error"));
      setAuthBusy(false);
    }
  }

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
          <span className="salon-lang" role="group" aria-label={t("nav.lang")}>
            <button type="button" className={locale === "fr" ? "is-on" : undefined} onClick={() => setLocale("fr")}>
              {t("lang.fr")}
            </button>
            <button type="button" className={locale === "en" ? "is-on" : undefined} onClick={() => setLocale("en")}>
              {t("lang.en")}
            </button>
          </span>
          <span className="salon-account">
            {user ? <small>{user.email}</small> : null}
            <button type="button" onClick={() => void onAuth()} disabled={authBusy}>
              {authBusy ? t("auth.busy") : user ? t("auth.out") : t("auth.enter")}
            </button>
          </span>
        </nav>
      </header>
      {authError ? <p className="salon-auth-error" role="alert">{authError}</p> : null}
      {children}
      <footer className="salon-foot">
        <p>{t("foot.line")}</p>
        <nav aria-label={t("foot.nav")}>
          <Link to="/salon/agents">{t("nav.agents")}</Link>
          <a href="mailto:contact@kayroslab.com">{t("contact")}</a>
        </nav>
      </footer>
    </div>
  );
}
