import { Link } from "@tanstack/react-router";
import type { Locale } from "@/lib/salon/i18n";
import { fluxT } from "@/lib/salon/x/copy";

export function FluxLink({ circleId, locale }: { circleId: string; locale: Locale }) {
  return (
    <Link to="/salon/flux/$circleId" params={{ circleId }} className="salon-back">
      {fluxT(locale, "nav")}
    </Link>
  );
}
