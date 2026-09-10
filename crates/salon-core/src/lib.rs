//! Salon — protocole d’un cercle de lecture.
//!
//! Pas un salon Slack. Un cercle : un texte, des rôles, des tours, une minute.
//! Le verdict n’est pas GO/NO_GO. On tient, on relit, ou on laisse.
//!
//! ABI WASM (wasm32-unknown-unknown, C, sans import) :
//!   salon_heap()     → pointeur du tas (48 KiB) dans la mémoire linéaire
//!   salon_out_off()  → décalage de la réponse dans le tas (24 KiB)
//!   salon_eval(len)  → lit UTF-8 JSON en heap[0..len], écrit u32 LE + JSON
//!                      en heap[out_off..], retourne le *pointeur absolu*
//!                      de cette réponse (heap + out_off)

use serde::{Deserialize, Serialize};

const HEAP_CAP: usize = 48 * 1024;
const OUT_OFF: usize = 24 * 1024;

static mut HEAP: [u8; HEAP_CAP] = [0; HEAP_CAP];

fn heap_ptr() -> *mut u8 {
    // SAFETY: wasm32 single-threadé ; salon_eval n’est pas réentrant.
    core::ptr::addr_of_mut!(HEAP) as *mut u8
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Hote,
    Lecteur,
    Objecteur,
    Secretaire,
    Invite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Lecture,
    Objection,
    Defense,
    Concession,
    Synthese,
    Minute,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Tenir,
    Relire,
    Laisser,
}

#[derive(Debug, Deserialize)]
pub struct EvalInput {
    pub members: Vec<MemberIn>,
    pub turns: Vec<TurnIn>,
}

#[derive(Debug, Deserialize)]
pub struct MemberIn {
    pub role: Role,
}

#[derive(Debug, Deserialize)]
pub struct TurnIn {
    pub role: Role,
    pub kind: Kind,
    pub text: String,
    pub has_citation: bool,
}

#[derive(Debug, Serialize)]
pub struct EvalOutput {
    pub polyphony: f32,
    pub tension: f32,
    pub fidelity: f32,
    pub closure: f32,
    pub next_kind: Kind,
    pub next_role: Role,
    pub verdict: Option<Verdict>,
    pub note: String,
}

impl Role {
    #[allow(dead_code)]
    fn expected_kind(self) -> Kind {
        match self {
            Role::Lecteur => Kind::Lecture,
            Role::Objecteur => Kind::Objection,
            Role::Hote => Kind::Synthese,
            Role::Secretaire => Kind::Minute,
            Role::Invite => Kind::Concession,
        }
    }
}

fn next_after(kind: Kind) -> (Role, Kind) {
    match kind {
        Kind::Lecture => (Role::Objecteur, Kind::Objection),
        Kind::Objection => (Role::Lecteur, Kind::Defense),
        Kind::Defense => (Role::Invite, Kind::Concession),
        Kind::Concession => (Role::Hote, Kind::Synthese),
        Kind::Synthese => (Role::Secretaire, Kind::Minute),
        Kind::Minute => (Role::Hote, Kind::Synthese),
    }
}

fn has_role(members: &[MemberIn], role: Role) -> bool {
    members.iter().any(|m| m.role == role)
}

fn adjust_next(members: &[MemberIn], role: Role, kind: Kind) -> (Role, Kind) {
    if has_role(members, role) {
        return (role, kind);
    }
    match role {
        Role::Invite => {
            if has_role(members, Role::Hote) {
                (Role::Hote, Kind::Synthese)
            } else {
                (Role::Lecteur, Kind::Defense)
            }
        }
        Role::Objecteur => (Role::Hote, Kind::Objection),
        Role::Secretaire => (Role::Hote, Kind::Minute),
        other => (other, kind),
    }
}

/// Évalue l’état d’une séance. Cœur du produit — tests sur l’hôte natif.
pub fn evaluate(input: &EvalInput) -> EvalOutput {
    let n_members = input.members.len().max(1) as f32;
    let spoken: Vec<Role> = {
        let mut v: Vec<Role> = input.turns.iter().map(|t| t.role).collect();
        v.sort_by_key(|r| *r as u8);
        v.dedup();
        v
    };
    let polyphony = (spoken.len() as f32 / n_members).clamp(0.0, 1.0);

    let objections = input
        .turns
        .iter()
        .filter(|t| t.kind == Kind::Objection)
        .count();
    let defenses = input
        .turns
        .iter()
        .filter(|t| matches!(t.kind, Kind::Defense | Kind::Concession | Kind::Synthese))
        .count();
    let tension = if objections == 0 {
        0.12
    } else {
        (objections as f32 / (objections + defenses).max(1) as f32).clamp(0.0, 1.0)
    };

    let cited = input.turns.iter().filter(|t| t.has_citation).count();
    let fidelity = if input.turns.is_empty() {
        0.0
    } else {
        (cited as f32 / input.turns.len() as f32).clamp(0.0, 1.0)
    };

    let has_synthese = input.turns.iter().any(|t| t.kind == Kind::Synthese);
    let has_minute = input.turns.iter().any(|t| t.kind == Kind::Minute);
    let closure = match (has_synthese, has_minute) {
        (true, true) => 0.92,
        (true, false) => 0.55,
        (false, true) => 0.4,
        (false, false) => (input.turns.len() as f32 / 8.0).clamp(0.0, 0.35),
    };

    let (next_role, next_kind) = if let Some(last) = input.turns.last() {
        let (r, k) = next_after(last.kind);
        adjust_next(&input.members, r, k)
    } else {
        adjust_next(&input.members, Role::Lecteur, Kind::Lecture)
    };

    let verdict = if input.turns.len() < 3 {
        None
    } else if has_minute && polyphony >= 0.66 && tension <= 0.45 && fidelity >= 0.4 {
        Some(Verdict::Tenir)
    } else if tension >= 0.7 || fidelity < 0.25 {
        Some(Verdict::Relire)
    } else if has_synthese && polyphony < 0.5 {
        Some(Verdict::Laisser)
    } else if has_minute {
        Some(Verdict::Relire)
    } else {
        None
    };

    let note = match (&verdict, next_kind) {
        (Some(Verdict::Tenir), _) => {
            "Le cercle peut tenir cette lecture. La minute la consigne."
        }
        (Some(Verdict::Relire), _) => {
            "Trop d’objections ou trop peu de citations : on relit le passage."
        }
        (Some(Verdict::Laisser), _) => {
            "La synthèse est venue trop tôt. On laisse ce texte pour une autre séance."
        }
        (_, Kind::Lecture) => "Le lecteur ouvre — le texte d’abord, le commentaire ensuite.",
        (_, Kind::Objection) => "L’objecteur doit citer. Une objection sans lieu dans le texte ne compte pas.",
        (_, Kind::Defense) => "Le lecteur (ou l’hôte) répond sans diluer l’objection.",
        (_, Kind::Concession) => "Un invité peut accorder, nuancer, ou ouvrir un second front.",
        (_, Kind::Synthese) => "L’hôte clôt : ce que le cercle retient, en une seule tenue.",
        (_, Kind::Minute) => "Le secrétaire écrit ce qui a été dit, non ce qu’on aurait voulu dire.",
    }
    .to_string();

    EvalOutput {
        polyphony,
        tension,
        fidelity,
        closure,
        next_kind,
        next_role,
        verdict,
        note,
    }
}

fn write_out(bytes: &[u8]) -> i32 {
    let len = bytes.len().min(HEAP_CAP - OUT_OFF - 4);
    unsafe {
        let out = heap_ptr().add(OUT_OFF);
        let n = (len as u32).to_le_bytes();
        core::ptr::copy_nonoverlapping(n.as_ptr(), out, 4);
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), out.add(4), len);
        out as i32
    }
}

#[no_mangle]
pub extern "C" fn salon_heap() -> i32 {
    heap_ptr() as i32
}

#[no_mangle]
pub extern "C" fn salon_out_off() -> i32 {
    OUT_OFF as i32
}

/// Lit JSON en `HEAP[0 .. in_len]`, écrit le résultat à `HEAP[OUT_OFF]`.
/// Retourne le pointeur absolu de la réponse (heap + OUT_OFF).
#[no_mangle]
pub extern "C" fn salon_eval(in_len: i32) -> i32 {
    let n = in_len.max(0) as usize;
    let n = n.min(OUT_OFF);
    let parsed: Result<EvalInput, _> =
        unsafe { serde_json::from_slice(core::slice::from_raw_parts(heap_ptr(), n)) };
    match parsed {
        Ok(input) => {
            let out = evaluate(&input);
            let bytes = serde_json::to_vec(&out).unwrap_or_else(|_| b"{}".to_vec());
            write_out(&bytes)
        }
        Err(_) => {
            let fallback = serde_json::to_vec(&EvalOutput {
                polyphony: 0.0,
                tension: 0.0,
                fidelity: 0.0,
                closure: 0.0,
                next_kind: Kind::Lecture,
                next_role: Role::Lecteur,
                verdict: None,
                note: "Le protocole n'a pas pu lire cette séance.".into(),
            })
            .unwrap_or_else(|_| b"{}".to_vec());
            write_out(&fallback)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(role: Role) -> MemberIn {
        MemberIn { role }
    }
    fn turn(role: Role, kind: Kind, text: &str, cite: bool) -> TurnIn {
        TurnIn {
            role,
            kind,
            text: text.into(),
            has_citation: cite,
        }
    }

    #[test]
    fn empty_session_asks_the_reader() {
        let out = evaluate(&EvalInput {
            members: vec![member(Role::Lecteur), member(Role::Objecteur)],
            turns: vec![],
        });
        assert_eq!(out.next_role, Role::Lecteur);
        assert_eq!(out.next_kind, Kind::Lecture);
        assert!(out.verdict.is_none());
    }

    #[test]
    fn objection_follows_reading() {
        let out = evaluate(&EvalInput {
            members: vec![
                member(Role::Lecteur),
                member(Role::Objecteur),
                member(Role::Hote),
            ],
            turns: vec![turn(
                Role::Lecteur,
                Kind::Lecture,
                "Pascal ouvre le fragment.",
                true,
            )],
        });
        assert_eq!(out.next_role, Role::Objecteur);
        assert_eq!(out.next_kind, Kind::Objection);
        assert!(out.fidelity > 0.9);
    }

    #[test]
    fn holding_requires_polyphony_and_minute() {
        let members = vec![
            member(Role::Lecteur),
            member(Role::Objecteur),
            member(Role::Hote),
            member(Role::Secretaire),
        ];
        let turns = vec![
            turn(Role::Lecteur, Kind::Lecture, "Lire le fragment.", true),
            turn(Role::Objecteur, Kind::Objection, "Le cœur n'est pas une preuve.", true),
            turn(Role::Lecteur, Kind::Defense, "Ce n'est pas une preuve, c'est une tenue.", true),
            turn(Role::Hote, Kind::Synthese, "On tient : raison et cœur ne se substituent pas.", true),
            turn(Role::Secretaire, Kind::Minute, "Séance close. Tenir le fragment 277.", true),
        ];
        let out = evaluate(&EvalInput { members, turns });
        assert_eq!(out.verdict, Some(Verdict::Tenir));
        assert!(out.polyphony >= 0.66);
    }

    #[test]
    fn unread_citation_pushes_reread() {
        let out = evaluate(&EvalInput {
            members: vec![member(Role::Lecteur), member(Role::Objecteur), member(Role::Hote)],
            turns: vec![
                turn(Role::Lecteur, Kind::Lecture, "Je trouve cela beau.", false),
                turn(Role::Objecteur, Kind::Objection, "C'est trop commode.", false),
                turn(Role::Hote, Kind::Synthese, "Passons.", false),
                turn(Role::Hote, Kind::Minute, "Rien.", false),
            ],
        });
        assert_eq!(out.verdict, Some(Verdict::Relire));
    }
}
