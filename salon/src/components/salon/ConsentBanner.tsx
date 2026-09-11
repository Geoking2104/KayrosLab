import { useEffect, useState } from "react";
import { clearConsent, hasConsented, saveConsent } from "@/lib/salon/consent";
import { useT } from "@/lib/salon/i18n";

export function ConsentBanner() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!hasConsented());
    const onReview = () => {
      clearConsent();
      setOpen(true);
    };
    window.addEventListener("salon-consent-review", onReview);
    return () => window.removeEventListener("salon-consent-review", onReview);
  }, []);

  if (!open) return null;

  function choose(mode: "all" | "necessary") {
    saveConsent(mode);
    setOpen(false);
  }

  return (
    <aside className="c15t-banner" id="c15t-banner">
      <p>{t("cookies.banner")}</p>
      <div className="c15t-row">
        <button type="button" className="salon-btn" onClick={() => choose("necessary")}>
          {t("cookies.essential")}
        </button>
        <button type="button" className="salon-btn ghost" onClick={() => choose("all")}>
          {t("cookies.all")}
        </button>
      </div>
    </aside>
  );
}
