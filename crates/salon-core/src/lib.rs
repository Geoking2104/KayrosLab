//! Salon — moteur de parole des agents auteurs.
//!
//! Qui parle, et depuis quels passages. Le texte de la réplique n’est pas
//! ici : il est écrit par le modèle, collé à la mémoire des œuvres.
//!
//! ABI WASM (wasm32-unknown-unknown, C, sans import) :
//!   salon_heap()     → pointeur du tas (48 KiB)
//!   salon_out_off()  → décalage de la réponse (24 KiB)
//!   salon_eval(len)  → JSON in heap[0..len] → u32 LE + JSON en heap[out]

use serde::{Deserialize, Serialize};

const HEAP_CAP: usize = 48 * 1024;
const OUT_OFF: usize = 24 * 1024;

static mut HEAP: [u8; HEAP_CAP] = [0; HEAP_CAP];

fn heap_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(HEAP) as *mut u8
}

#[derive(Debug, Deserialize)]
pub struct EvalInput {
    #[serde(default)]
    pub op: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub passages: Vec<PassageIn>,
    #[serde(default)]
    pub seated: Vec<String>,
    #[serde(default)]
    pub last: Option<String>,
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub addressed: Option<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PassageIn {
    pub id: String,
    #[serde(default)]
    pub terms: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Move {
    pub id: String,
    pub act: String,
    pub to: String,
    pub figure: String,
    pub method: String,
}

#[derive(Debug, Serialize)]
pub struct EvalOutput {
    pub hits: Vec<Hit>,
    pub speakers: Vec<String>,
    pub moves: Vec<Move>,
    pub note: String,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub id: String,
    pub score: f32,
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| w.chars().count() >= 4)
        .map(|w| w.to_string())
        .collect()
}

pub fn retrieve(query: &str, passages: &[PassageIn]) -> Vec<Hit> {
    let q = tokenize(query);
    if q.is_empty() || passages.is_empty() {
        return passages
            .iter()
            .take(3)
            .map(|p| Hit {
                id: p.id.clone(),
                score: 0.1,
            })
            .collect();
    }
    let mut hits: Vec<Hit> = passages
        .iter()
        .map(|p| {
            let mut score = 0.0;
            for term in &p.terms {
                let t = term.to_lowercase();
                if q.iter().any(|w| *w == t || t.contains(w) || w.contains(&t)) {
                    score += 1.0;
                }
            }
            let den = (p.terms.len().max(1) as f32).sqrt();
            Hit {
                id: p.id.clone(),
                score: score / den,
            }
        })
        .collect();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(4);
    hits
}

pub fn figure(kind: &str, act: &str, query: &str) -> &'static str {
    if act == "objection" {
        return "concessio";
    }
    let q = query.to_lowercase();
    if kind == "philosophe" {
        if q.contains("dieu")
            || q.contains("providence")
            || q.contains("optimisme")
            || q.contains("vertu")
        {
            return "ironia";
        }
        if q.contains('?') || q.contains("pourquoi") || q.contains("comment") || q.contains("faut")
        {
            return "interrogatio";
        }
        return "distinctio";
    }
    match kind {
        "essayiste" => "sententia",
        "écrivain" | "dramaturge" | "poète" => "hypotypose",
        "savant" | "économiste" => "exemplum",
        _ => "exemplum",
    }
}

fn kind_of<'a>(id: &str, seated: &[String], kinds: &'a [String]) -> &'a str {
    seated
        .iter()
        .position(|s| s == id)
        .and_then(|i| kinds.get(i))
        .map(|s| s.as_str())
        .unwrap_or("")
}

fn is_socratic(id: &str) -> bool {
    id == "platon" || id == "socrate"
}

fn with_craft(mut moves: Vec<Move>, seated: &[String], kinds: &[String], query: &str) -> Vec<Move> {
    for m in &mut moves {
        if is_socratic(&m.id) {
            m.method = "elenchus".into();
            m.figure = "interrogatio".into();
        } else {
            m.method = "rhetorique".into();
            m.figure = figure(kind_of(&m.id, seated, kinds), &m.act, query).into();
        }
    }
    if moves.len() >= 2 && moves[0].method == "elenchus" {
        let first_id = moves[0].id.clone();
        let second_id = moves[1].id.clone();
        moves[1].act = "reponse".into();
        moves[1].to = first_id;
        if !is_socratic(&second_id) {
            moves[1].method = "rhetorique".into();
            moves[1].figure = figure(kind_of(&second_id, seated, kinds), "reponse", query).into();
        }
    }
    moves
}

pub fn floor(
    seated: &[String],
    last: Option<&str>,
    recent: &[String],
    mode: &str,
    addressed: Option<&str>,
    kinds: &[String],
    query: &str,
) -> Vec<Move> {
    if seated.is_empty() {
        return vec![];
    }
    let mut spoken: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    for id in seated {
        spoken.insert(id.as_str(), 0);
    }
    for id in recent {
        if let Some(n) = spoken.get_mut(id.as_str()) {
            *n += 1;
        }
    }
    let mut ranked: Vec<&String> = seated.iter().collect();
    ranked.sort_by(|a, b| {
        let ca = spoken.get(a.as_str()).copied().unwrap_or(0);
        let cb = spoken.get(b.as_str()).copied().unwrap_or(0);
        ca.cmp(&cb).then_with(|| a.cmp(b))
    });

    let reply_to = last.filter(|id| *id != "user").unwrap_or("user");

    if mode == "talk" {
        let id = ranked
            .iter()
            .find(|id| last != Some(id.as_str()))
            .map(|id| (*id).clone())
            .unwrap_or_else(|| seated[0].clone());
        return with_craft(
            vec![Move {
                id,
                act: "reponse".into(),
                to: reply_to.into(),
                figure: String::new(),
                method: String::new(),
            }],
            seated,
            kinds,
            query,
        );
    }

    let first = addressed
        .filter(|id| seated.iter().any(|s| s == id))
        .map(|id| id.to_string())
        .or_else(|| {
            ranked
                .iter()
                .find(|id| last != Some(id.as_str()))
                .map(|id| (*id).clone())
        })
        .unwrap_or_else(|| seated[0].clone());

    let mut moves = vec![Move {
        id: first.clone(),
        act: "reponse".into(),
        to: if last == Some("user") || last.is_none() {
            "user".into()
        } else {
            reply_to.into()
        },
        figure: String::new(),
        method: String::new(),
    }];

    if let Some(second) = ranked.iter().find(|id| id.as_str() != first && last != Some(id.as_str())) {
        moves.push(Move {
            id: (*second).clone(),
            act: "objection".into(),
            to: first,
            figure: String::new(),
            method: String::new(),
        });
    }
    with_craft(moves, seated, kinds, query)
}

pub fn evaluate(input: &EvalInput) -> EvalOutput {
    let op = input.op.as_str();
    if op == "floor" {
        let moves = floor(
            &input.seated,
            input.last.as_deref(),
            &input.recent,
            if input.mode.is_empty() { "ask" } else { &input.mode },
            input.addressed.as_deref(),
            &input.kinds,
            &input.query,
        );
        let speakers: Vec<String> = moves.iter().map(|m| m.id.clone()).collect();
        return EvalOutput {
            hits: vec![],
            speakers,
            moves,
            note: "parole".into(),
        };
    }
    let hits = retrieve(&input.query, &input.passages);
    EvalOutput {
        hits,
        speakers: vec![],
        moves: vec![],
        note: "mémoire".into(),
    }
}


fn write_out(bytes: &[u8]) -> i32 {
    let heap = heap_ptr();
    let cap = HEAP_CAP - OUT_OFF;
    let n = bytes.len().min(cap.saturating_sub(4));
    unsafe {
        let out = heap.add(OUT_OFF);
        let len = (n as u32).to_le_bytes();
        core::ptr::copy_nonoverlapping(len.as_ptr(), out, 4);
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), out.add(4), n);
        out as i32
    }
}

#[no_mangle]
pub extern "C" fn salon_heap() -> *mut u8 {
    heap_ptr()
}

#[no_mangle]
pub extern "C" fn salon_out_off() -> i32 {
    OUT_OFF as i32
}

#[no_mangle]
pub extern "C" fn salon_eval(in_len: i32) -> i32 {
    let heap = heap_ptr();
    let len = (in_len as usize).min(OUT_OFF);
    let slice = unsafe { core::slice::from_raw_parts(heap, len) };
    let parsed: Result<EvalInput, _> = serde_json::from_slice(slice);
    let out = match parsed {
        Ok(input) => evaluate(&input),
        Err(_) => EvalOutput {
            hits: vec![],
            speakers: vec![],
            moves: vec![],
            note: "json".into(),
        },
    };
    let bytes = serde_json::to_vec(&out).unwrap_or_else(|_| b"{}".to_vec());
    write_out(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retrieve_ranks_matching_terms() {
        let passages = vec![
            PassageIn {
                id: "a".into(),
                terms: vec!["liberte".into(), "contrat".into()],
            },
            PassageIn {
                id: "b".into(),
                terms: vec!["lune".into(), "maree".into()],
            },
        ];
        let hits = retrieve("contrat social liberte", &passages);
        assert_eq!(hits[0].id, "a");
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn floor_rotates_and_skips_last() {
        let seated = vec!["voltaire".into(), "rousseau".into(), "montaigne".into()];
        let kinds = vec!["philosophe".into(), "philosophe".into(), "essayiste".into()];
        let moves = floor(
            &seated,
            Some("voltaire"),
            &["voltaire".into()],
            "ask",
            None,
            &kinds,
            "",
        );
        assert!(!moves.iter().any(|m| m.id == "voltaire"));
        assert_eq!(moves[0].act, "reponse");
        assert_eq!(moves.get(1).map(|m| m.act.as_str()), Some("objection"));
        assert_eq!(moves.get(1).map(|m| m.to.as_str()), Some(moves[0].id.as_str()));
    }

    #[test]
    fn floor_honours_address() {
        let seated = vec!["voltaire".into(), "rousseau".into(), "montaigne".into()];
        let kinds = vec!["philosophe".into(), "philosophe".into(), "essayiste".into()];
        let moves = floor(
            &seated,
            Some("user"),
            &[],
            "ask",
            Some("voltaire"),
            &kinds,
            "l'optimisme n'est-il qu'une politesse ?",
        );
        assert_eq!(moves[0].id, "voltaire");
        assert_eq!(moves[0].to, "user");
        assert_eq!(moves[0].figure, "ironia");
        assert_eq!(moves[1].act, "objection");
        assert_eq!(moves[1].to, "voltaire");
        assert_eq!(moves[1].figure, "concessio");
    }

    #[test]
    fn floor_talk_is_one_reply() {
        let seated = vec!["voltaire".into(), "rousseau".into(), "montaigne".into()];
        let kinds = vec!["philosophe".into(), "philosophe".into(), "essayiste".into()];
        let moves = floor(
            &seated,
            Some("rousseau"),
            &["rousseau".into()],
            "talk",
            None,
            &kinds,
            "la liberté",
        );
        assert_eq!(moves.len(), 1);
        assert_ne!(moves[0].id, "rousseau");
        assert_eq!(moves[0].to, "rousseau");
    }

    #[test]
    fn floor_socratic_elenchus() {
        let seated = vec!["platon".into(), "aristote".into(), "montaigne".into()];
        let kinds = vec!["philosophe".into(), "philosophe".into(), "essayiste".into()];
        let moves = floor(
            &seated,
            Some("user"),
            &[],
            "ask",
            Some("platon"),
            &kinds,
            "qu'est-ce qu'une chose juste ?",
        );
        assert_eq!(moves[0].id, "platon");
        assert_eq!(moves[0].method, "elenchus");
        assert_eq!(moves[0].figure, "interrogatio");
        assert_eq!(moves[1].act, "reponse");
        assert_eq!(moves[1].to, "platon");
        assert_ne!(moves[1].method, "elenchus");
    }

    #[test]
    fn evaluate_retrieve_op() {
        let out = evaluate(&EvalInput {
            op: "retrieve".into(),
            query: "justice".into(),
            passages: vec![PassageIn {
                id: "p1".into(),
                terms: vec!["justice".into()],
            }],
            seated: vec![],
            last: None,
            recent: vec![],
            mode: String::new(),
            addressed: None,
            kinds: vec![],
        });
        assert_eq!(out.hits[0].id, "p1");
        assert_eq!(out.note, "mémoire");
    }
}
