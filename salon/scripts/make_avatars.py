#!/usr/bin/env python3
"""Hallmark avatars: monograms for new authors, symbols for traditions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "avatars"
PUB = ROOT.parent / "backend/web/public/salon/avatars"

PAPER = "#f4ead6"
INK = "#8b1e2d"
MUTED = "#5c4638"

def write(name: str, svg: str) -> None:
    for dest in (OUT, PUB):
        dest.mkdir(parents=True, exist_ok=True)
        (dest / name).write_text(svg.strip() + "\n", encoding="utf-8")

def monogram(letters: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img">
  <rect width="88" height="88" fill="{PAPER}"/>
  <circle cx="44" cy="44" r="36" fill="none" stroke="{INK}" stroke-width="1.2"/>
  <text x="44" y="52" text-anchor="middle" font-family="Fraunces, Palatino, serif" font-size="22" fill="{INK}">{letters}</text>
</svg>'''

SYMBOLS = {
    "christianisme.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Croix">
  <rect width="88" height="88" fill="{PAPER}"/>
  <rect x="40" y="14" width="8" height="60" fill="{INK}"/>
  <rect x="24" y="30" width="40" height="8" fill="{INK}"/>
</svg>''',
    "judaisme.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Étoile de David">
  <rect width="88" height="88" fill="{PAPER}"/>
  <polygon points="44,14 70,68 18,68" fill="none" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
  <polygon points="44,74 18,20 70,20" fill="none" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
</svg>''',
    "islam.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Croissant">
  <rect width="88" height="88" fill="{PAPER}"/>
  <circle cx="40" cy="44" r="24" fill="{INK}"/>
  <circle cx="50" cy="40" r="18" fill="{PAPER}"/>
  <polygon points="64,22 68,32 78,32 70,38 74,48 64,42 54,48 58,38 50,32 60,32" fill="{INK}"/>
</svg>''',
    "hindouisme.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Om">
  <rect width="88" height="88" fill="{PAPER}"/>
  <text x="44" y="58" text-anchor="middle" font-size="42" fill="{INK}" font-family="serif">ॐ</text>
</svg>''',
    "bouddhisme.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Roue du Dharma">
  <rect width="88" height="88" fill="{PAPER}"/>
  <circle cx="44" cy="44" r="26" fill="none" stroke="{INK}" stroke-width="3"/>
  <circle cx="44" cy="44" r="6" fill="{INK}"/>
  <g stroke="{INK}" stroke-width="2.2" stroke-linecap="round">
    <line x1="44" y1="18" x2="44" y2="38"/>
    <line x1="44" y1="50" x2="44" y2="70"/>
    <line x1="18" y1="44" x2="38" y2="44"/>
    <line x1="50" y1="44" x2="70" y2="44"/>
    <line x1="25.5" y1="25.5" x2="38.5" y2="38.5"/>
    <line x1="49.5" y1="49.5" x2="62.5" y2="62.5"/>
    <line x1="62.5" y1="25.5" x2="49.5" y2="38.5"/>
    <line x1="38.5" y1="49.5" x2="25.5" y2="62.5"/>
  </g>
</svg>''',
    "taoisme.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" role="img" aria-label="Yin yang">
  <rect width="88" height="88" fill="{PAPER}"/>
  <circle cx="44" cy="44" r="28" fill="{INK}"/>
  <path d="M44 16 A28 28 0 0 1 44 72 A14 14 0 0 1 44 44 A14 14 0 0 0 44 16 Z" fill="{PAPER}"/>
  <circle cx="44" cy="30" r="5" fill="{INK}"/>
  <circle cx="44" cy="58" r="5" fill="{PAPER}"/>
  <circle cx="44" cy="44" r="28" fill="none" stroke="{MUTED}" stroke-width="1"/>
</svg>''',
}

MONOGRAMS = {
    "seneca": "SÉ",
    "ciceron": "CI",
    "epictete": "ÉP",
    "epicure": "ÉC",
    "augustin": "AH",
    "boece": "BO",
    "aquinas": "TA",
    "hobbes": "TH",
    "locke": "JL",
    "hume": "DH",
    "leibniz": "GL",
    "pascal": "BP",
    "berkeley": "GB",
    "hegel": "GH",
    "schopenhauer": "AS",
    "kierkegaard": "SK",
    "mill": "JM",
    "emerson": "RE",
    "james": "WJ",
    "diderot": "DD",
}

def main() -> None:
    for name, svg in SYMBOLS.items():
        write(name, svg)
    for ident, letters in MONOGRAMS.items():
        write(f"{ident}.svg", monogram(letters))
    print("avatars", len(SYMBOLS) + len(MONOGRAMS))

if __name__ == "__main__":
    main()
