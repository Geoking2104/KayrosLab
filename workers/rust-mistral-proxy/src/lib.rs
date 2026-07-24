//! KayrosLab — Mistral demo proxy (Cloudflare Worker, Rust)
//!
//! Holds MISTRAL_API_KEY as a Worker secret. The browser never sees the key.
//!
//! Deploy:
//!   cd workers/rust-mistral-proxy
//!   npx wrangler deploy
//!   npx wrangler secret put MISTRAL_API_KEY
//!
//! Then set PROXY_URL in kayroslab-complete-with-ai-agents.html to the Worker URL.

use serde::{Deserialize, Serialize};
use worker::*;

const MODEL: &str = "mistral-small-latest";
const MAX_TOKENS: u32 = 900;
const MAX_REQ_PER_HOUR: u32 = 20;

const ALLOWED_ORIGINS: &[&str] = &[
    "https://www.kayroslab.com",
    "https://kayroslab.com",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
];

#[derive(Deserialize)]
struct InBody {
    system: Option<String>,
    user: String,
}

#[derive(Serialize)]
struct OutOk {
    content: String,
    model: String,
}

#[derive(Serialize)]
struct OutErr {
    error: String,
}

#[derive(Serialize)]
struct MistralMsg {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct MistralReq {
    model: String,
    messages: Vec<MistralMsg>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Deserialize)]
struct MistralChoiceMsg {
    content: Option<String>,
}

#[derive(Deserialize)]
struct MistralChoice {
    message: MistralChoiceMsg,
}

#[derive(Deserialize)]
struct MistralRes {
    choices: Option<Vec<MistralChoice>>,
}

fn cors(origin: &str) -> Headers {
    let allowed = if ALLOWED_ORIGINS.contains(&origin) {
        origin
    } else {
        ALLOWED_ORIGINS[0]
    };
    let mut h = Headers::new();
    let _ = h.set("Access-Control-Allow-Origin", allowed);
    let _ = h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    let _ = h.set("Access-Control-Allow-Headers", "Content-Type");
    let _ = h.set("Access-Control-Max-Age", "86400");
    let _ = h.set("Content-Type", "application/json");
    h
}

fn json_response(status: u16, body: &str, origin: &str) -> Result<Response> {
    let mut res = Response::from_bytes(body.as_bytes().to_vec())?;
    *res.status_mut() = status;
    let headers = cors(origin);
    for (k, v) in headers.entries() {
        let _ = res.headers_mut().set(&k, &v);
    }
    Ok(res)
}

fn err_json(status: u16, msg: &str, origin: &str) -> Result<Response> {
    let body = serde_json::to_string(&OutErr {
        error: msg.to_string(),
    })
    .unwrap_or_else(|_| r#"{"error":"serialize failed"}"#.to_string());
    json_response(status, &body, origin)
}

#[event(fetch)]
async fn main(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let origin = req
        .headers()
        .get("Origin")?
        .unwrap_or_else(|| ALLOWED_ORIGINS[0].to_string());

    if req.method() == Method::Options {
        return json_response(204, "", &origin);
    }

    if req.method() != Method::Post {
        return err_json(405, "Method not allowed", &origin);
    }

    // Soft rate-limit hint via header (full durable limit needs KV/DO)
    let _ip = req
        .headers()
        .get("CF-Connecting-IP")?
        .unwrap_or_else(|| "unknown".into());

    let api_key = match env.secret("MISTRAL_API_KEY") {
        Ok(s) => s.to_string(),
        Err(_) => {
            return err_json(500, "Server misconfigured: MISTRAL_API_KEY missing", &origin);
        }
    };

    let body: InBody = match req.json().await {
        Ok(b) => b,
        Err(_) => return err_json(400, "Invalid JSON body", &origin),
    };

    if body.user.trim().is_empty() {
        return err_json(400, "Missing user message", &origin);
    }

    let system = body
        .system
        .unwrap_or_default()
        .chars()
        .take(4000)
        .collect::<String>();
    let user = body.user.chars().take(6000).collect::<String>();

    let mut messages = Vec::new();
    if !system.is_empty() {
        messages.push(MistralMsg {
            role: "system".into(),
            content: system,
        });
    }
    messages.push(MistralMsg {
        role: "user".into(),
        content: user,
    });

    let payload = MistralReq {
        model: MODEL.into(),
        messages,
        temperature: 0.4,
        max_tokens: MAX_TOKENS,
    };

    let mut headers = Headers::new();
    let _ = headers.set("Content-Type", "application/json");
    let _ = headers.set("Authorization", &format!("Bearer {}", api_key));

    let mut init = RequestInit::new();
    init.with_method(Method::Post);
    init.with_headers(headers);
    init.with_body(Some(serde_json::to_string(&payload)?.into()));

    let mistral_req = Request::new_with_init("https://api.mistral.ai/v1/chat/completions", &init)?;
    let mut mistral_res = Fetch::Request(mistral_req).send().await?;

    if mistral_res.status_code() >= 400 {
        let detail = mistral_res.text().await.unwrap_or_default();
        let msg = format!(
            "Upstream Mistral {}: {}",
            mistral_res.status_code(),
            detail.chars().take(180).collect::<String>()
        );
        return err_json(mistral_res.status_code(), &msg, &origin);
    }

    let parsed: MistralRes = match mistral_res.json().await {
        Ok(p) => p,
        Err(_) => return err_json(502, "Invalid upstream JSON", &origin),
    };

    let content = parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message.content)
        .unwrap_or_else(|| "Aucune réponse générée.".into());

    let out = OutOk {
        content,
        model: MODEL.into(),
    };
    let body = serde_json::to_string(&out)?;
    json_response(200, &body, &origin)
}
