# Salon × WhatsApp (P1)

Branche `feat/salon-whatsapp`. Modèle : un numéro, plusieurs voix, un groupe par cercle (P2 plus tard).

## Endpoints

- `GET /v1/salon/whatsapp/webhook` — challenge Meta (`hub.verify_token` = `WA_VERIFY_TOKEN`)
- `POST /v1/salon/whatsapp/webhook` — journal `wamid` idempotent, parse `@` / commandes
- `POST /v1/salon/whatsapp/open` — opt-in + E.164 ; envoie `salon_invite` si le compte est armé, sinon renvoie `waMe`

Sans `WA_TOKEN`, l’ouverture reste honnête : la demande est journalisée, aucun template ne part.
