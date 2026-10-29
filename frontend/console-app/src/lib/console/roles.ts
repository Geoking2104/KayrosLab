import type { MemberRole, StakeholderRole } from "./live";
import { t } from "@/lib/i18n";

export const STAKEHOLDER_ROLES: { id: StakeholderRole; label: string; hint: string }[] = [
  { id: "decideur", get label() { return t("Décideur"); }, get hint() { return t("Arbitre et signe la décision"); } },
  { id: "sponsor", get label() { return t("Sponsor"); }, get hint() { return t("Porte le projet et ses moyens"); } },
  { id: "consulte", get label() { return t("Consulté"); }, get hint() { return t("Donne son avis avant l’arbitrage"); } },
  { id: "informe", get label() { return t("Informé"); }, get hint() { return t("Reçoit la décision"); } },
];

export const MEMBER_ROLES: { id: MemberRole; label: string; hint: string }[] = [
  { id: "admin", get label() { return t("Admin"); }, get hint() { return t("Tout, y compris les membres"); } },
  { id: "comex", get label() { return "COMEX"; }, get hint() { return t("Arbitre et gère agents, projets, bibliothèque"); } },
  { id: "contributeur", get label() { return t("Contributeur"); }, get hint() { return t("Lance des missions et répond aux questions"); } },
  { id: "lecteur", get label() { return t("Lecteur"); }, get hint() { return t("Consulte sans modifier"); } },
];
