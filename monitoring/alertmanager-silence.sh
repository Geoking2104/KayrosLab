#!/usr/bin/env bash
# alertmanager-silence.sh — silences Alertmanager (API v2) pendant un
# déploiement ou une maintenance. Adapté du dossier « Architecture &
# Monitoring Redis HA » (§5) pour le VPS mono-nœud :
#   - Alertmanager local (127.0.0.1:9093) ;
#   - « soft-fail » par défaut : Alertmanager absent, arrêté ou injoignable
#     n'interrompt JAMAIS un déploiement (avertissement + code 0) ;
#   - pas de dépendance à jq (extraction de l'ID en sed) ;
#   - `run` propage le code de sortie de la commande encadrée.
#
# Usage :
#   monitoring/alertmanager-silence.sh start            # crée un silence (30 min par défaut)
#   monitoring/alertmanager-silence.sh stop             # expire le silence créé par `start`
#   monitoring/alertmanager-silence.sh run <commande…>  # silence le temps de la commande
#   monitoring/alertmanager-silence.sh status           # silences actifs du service
#
# Variables : ALERTMANAGER_URL (http://127.0.0.1:9093), SERVICE_NAME
# (kayros-api), ENVIRONMENT (production), DURATION_MINUTES (30),
# SILENCE_COMMENT, SILENCE_STRICT=1 pour échouer si Alertmanager est absent.
set -uo pipefail

ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://127.0.0.1:9093}"
SERVICE_NAME="${SERVICE_NAME:-kayros-api}"
ENVIRONMENT="${ENVIRONMENT:-production}"
DURATION_MINUTES="${DURATION_MINUTES:-30}"
SILENCE_COMMENT="${SILENCE_COMMENT:-Maintenance déploiement automatique}"
SILENCE_STRICT="${SILENCE_STRICT:-0}"
SILENCE_ID_FILE="${SILENCE_ID_FILE:-${TMPDIR:-/tmp}/alertmanager_silence_${SERVICE_NAME}.txt}"
CURL_OPTS=(-sS --connect-timeout 3 --max-time 10)

log() { echo "[alertmanager-silence] $*" >&2; }
soft_fail() {
  log "AVERTISSEMENT : $*"
  if [[ "${SILENCE_STRICT}" == "1" ]]; then exit 1; fi
  return 0
}

if ! [[ "${DURATION_MINUTES}" =~ ^[0-9]+$ ]] || (( DURATION_MINUTES < 1 )); then
  log "DURATION_MINUTES invalide (${DURATION_MINUTES}) : 30 min retenues."
  DURATION_MINUTES=30
fi

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

alertmanager_ready() {
  command -v curl >/dev/null 2>&1 || { soft_fail "curl absent : silence ignoré."; return 1; }
  if ! curl "${CURL_OPTS[@]}" -o /dev/null -f "${ALERTMANAGER_URL}/-/ready" 2>/dev/null; then
    soft_fail "Alertmanager injoignable sur ${ALERTMANAGER_URL} : silence ignoré."
    return 1
  fi
}

create_silence() {
  alertmanager_ready || return 0
  local starts_at ends_at payload response silence_id
  starts_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  ends_at=$(date -u -d "+${DURATION_MINUTES} minutes" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date -u -v+"${DURATION_MINUTES}"M +"%Y-%m-%dT%H:%M:%SZ")
  payload=$(cat <<JSON
{
  "matchers": [
    { "name": "service", "value": "$(json_escape "${SERVICE_NAME}")", "isRegex": false, "isEqual": true },
    { "name": "env", "value": "$(json_escape "${ENVIRONMENT}")", "isRegex": false, "isEqual": true }
  ],
  "startsAt": "${starts_at}",
  "endsAt": "${ends_at}",
  "createdBy": "$(json_escape "${SILENCE_CREATED_BY:-CI/CD $(hostname 2>/dev/null || echo deploy)}")",
  "comment": "$(json_escape "${SILENCE_COMMENT}")"
}
JSON
)
  if ! response=$(curl "${CURL_OPTS[@]}" -f -X POST "${ALERTMANAGER_URL}/api/v2/silences" \
      -H "Content-Type: application/json" -d "${payload}" 2>&1); then
    soft_fail "création du silence refusée (${response})."
    return 0
  fi
  silence_id=$(printf '%s' "${response}" | sed -n 's/.*"silenceID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [[ -z "${silence_id}" ]]; then
    soft_fail "réponse inattendue d'Alertmanager : ${response}"
    return 0
  fi
  printf '%s\n' "${silence_id}" > "${SILENCE_ID_FILE}"
  log "Silence créé (service=${SERVICE_NAME}, env=${ENVIRONMENT}, ${DURATION_MINUTES} min). ID : ${silence_id}"
}

remove_silence() {
  [[ -f "${SILENCE_ID_FILE}" ]] || { log "Aucun silence à expirer."; return 0; }
  local silence_id
  silence_id=$(tr -cd 'A-Za-z0-9-' < "${SILENCE_ID_FILE}")
  rm -f "${SILENCE_ID_FILE}"
  [[ -n "${silence_id}" ]] || return 0
  if curl "${CURL_OPTS[@]}" -f -o /dev/null -X DELETE "${ALERTMANAGER_URL}/api/v2/silence/${silence_id}" 2>/dev/null; then
    log "Silence ${silence_id} expiré."
  else
    soft_fail "impossible d'expirer le silence ${silence_id} (il expirera seul à échéance)."
  fi
}

show_status() {
  alertmanager_ready || return 0
  curl "${CURL_OPTS[@]}" -G "${ALERTMANAGER_URL}/api/v2/silences" \
    --data-urlencode "filter=service=\"${SERVICE_NAME}\"" || soft_fail "lecture des silences impossible."
  echo
}

case "${1:-}" in
  start) create_silence ;;
  stop) remove_silence ;;
  status) show_status ;;
  run)
    shift
    if [[ $# -eq 0 ]]; then log "run : commande manquante."; exit 2; fi
    create_silence
    trap remove_silence EXIT
    "$@"
    ;;
  *)
    echo "Usage: $0 {start|stop|status|run <commande…>}" >&2
    exit 2
    ;;
esac
