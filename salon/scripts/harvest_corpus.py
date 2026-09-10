#!/usr/bin/env python3
"""Harvest public-domain works (Gutenberg) into salon catalog + corpus."""
from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "src/lib/salon/catalog.json"
CORPUS_PATH = ROOT / "src/lib/salon/corpus.json"
UA = "KayrosLab-Salon/1.0 (public-domain corpus; +https://www.kayroslab.com)"
NOISE = re.compile(
    r"expositor.?s bible|jeremiah\s*:|linked index|quotes and images|montaigne and shakspere|proclus on the|complete works of|the complete gutenberg|^life of|^the life of|biography|golden gems",
    re.I,
)

NEW_AUTHORS = [
    {
        "id": "seneca",
        "name": "Sénèque",
        "kind": "philosophe",
        "lang": "la",
        "era": "4 av. J.-C.–65 · stoïcisme",
        "blurb": "Le temps, la colère, la constance : un exercice quotidien, sans consolation facile.",
        "wikipedia": "Seneca the Younger",
        "monogram": "SÉ",
        "books": [
            (3794, "Moral letters to Lucilius"),
            (2378, "On Benefits"),
            (2208, "Of Providence"),
            (24769, "On the Shortness of Life"),
            (26587, "On Anger"),
        ],
    },
    {
        "id": "ciceron",
        "name": "Cicéron",
        "kind": "philosophe",
        "lang": "la",
        "era": "106–43 av. J.-C. · République",
        "blurb": "L’éloquence comme devoir civique : amitié, devoirs, et la res publica.",
        "wikipedia": "Cicero",
        "monogram": "CI",
        "books": [
            (7491, "De Officiis"),
            (2808, "Laelius on Friendship"),
            (54161, "Tusculan Disputations"),
            (60365, "On the Commonwealth"),
            (22647, "On Old Age"),
        ],
    },
    {
        "id": "epictete",
        "name": "Épictète",
        "kind": "philosophe",
        "lang": "el",
        "era": "50–135 · stoïcisme",
        "blurb": "Ce qui dépend de toi, ce qui n’en dépend pas. Une distinction, puis l’usage.",
        "wikipedia": "Epictetus",
        "monogram": "ÉP",
        "books": [
            (45109, "The Enchiridion"),
            (10661, "A Selection from the Discourses"),
            (871, "The Golden Sayings of Epictetus"),
            (16508, "The Teaching of Epictetus"),
            (365, "The Discourses"),
        ],
    },
    {
        "id": "epicure",
        "name": "Épicure",
        "kind": "philosophe",
        "lang": "el",
        "era": "341–270 av. J.-C. · Jardin",
        "blurb": "Le plaisir comme absence de trouble. Les atomes, l’amitié, la mort qui n’est rien.",
        "wikipedia": "Epicurus",
        "monogram": "ÉC",
        "books": [
            (921, "Lives of the Eminent Philosophers"),
            (57342, "Epicurus — Extant Remains"),
            (14291, "Letter to Menoeceus"),
            (10661, "A Selection from the Discourses"),
            (871, "The Golden Sayings of Epictetus"),
        ],
    },
    {
        "id": "augustin",
        "name": "Augustin d’Hippone",
        "kind": "philosophe",
        "lang": "la",
        "era": "354–430 · patristique",
        "blurb": "La mémoire, le temps, la grâce : un homme qui s’examine jusqu’à Dieu.",
        "wikipedia": "Augustine of Hippo",
        "monogram": "AH",
        "books": [
            (3296, "The Confessions"),
            (45304, "The City of God, Volume I"),
            (45305, "The City of God, Volume II"),
            (16467, "On Christian Doctrine"),
            (17488, "The Enchiridion"),
        ],
    },
    {
        "id": "boece",
        "name": "Boèce",
        "kind": "philosophe",
        "lang": "la",
        "era": "480–524 · consolation",
        "blurb": "Fortune, liberté, bien souverain : la philosophie visite la prison.",
        "wikipedia": "Boethius",
        "monogram": "BO",
        "books": [
            (14328, "The Consolation of Philosophy"),
            (16567, "Theological Tractates"),
            (208, "The Consolation of Philosophy (tr. James)"),
            (14167, "De Consolatione Philosophiae"),
            (14328, "The Consolation of Philosophy"),
        ],
    },
    {
        "id": "aquinas",
        "name": "Thomas d’Aquin",
        "kind": "philosophe",
        "lang": "la",
        "era": "1225–1274 · scolastique",
        "blurb": "Distinguer pour unir : l’acte, la puissance, et ce que la raison peut dire de Dieu.",
        "wikipedia": "Thomas Aquinas",
        "monogram": "TA",
        "books": [
            (17611, "Summa Contra Gentiles"),
            (17897, "On the Governance of Rulers"),
            (19970, "Aquinas Ethicus"),
            (14663, "Of God and His Creatures"),
            (41858, "The Summa Theologica"),
        ],
    },
    {
        "id": "hobbes",
        "name": "Thomas Hobbes",
        "kind": "philosophe",
        "lang": "en",
        "era": "1588–1679 · contrat",
        "blurb": "La peur, le pacte, le Léviathan : la paix comme artifice.",
        "wikipedia": "Thomas Hobbes",
        "monogram": "TH",
        "books": [
            (3207, "Leviathan"),
            (7196, "Behemoth"),
            (15728, "The Elements of Law"),
            (58587, "De Cive"),
            (3207, "Leviathan"),
        ],
    },
    {
        "id": "locke",
        "name": "John Locke",
        "kind": "philosophe",
        "lang": "en",
        "era": "1632–1704 · empirisme",
        "blurb": "L’entendement, la propriété, la tolérance : ce que l’expérience autorise.",
        "wikipedia": "John Locke",
        "monogram": "JL",
        "books": [
            (7370, "Two Treatises of Government"),
            (10615, "An Essay Concerning Humane Understanding"),
            (12387, "A Letter Concerning Toleration"),
            (13451, "Some Thoughts Concerning Education"),
            (36532, "Further Considerations Concerning Raising the Value of Money"),
        ],
    },
    {
        "id": "hume",
        "name": "David Hume",
        "kind": "philosophe",
        "lang": "en",
        "era": "1711–1776 · Lumières écossaises",
        "blurb": "Coutume, causalité, sympathie : le scepticisme qui continue de vivre.",
        "wikipedia": "David Hume",
        "monogram": "DH",
        "books": [
            (9662, "An Enquiry Concerning Human Understanding"),
            (4705, "A Treatise of Human Nature"),
            (4320, "An Enquiry Concerning the Principles of Morals"),
            (10509, "Dialogues Concerning Natural Religion"),
            (50132, "Essays Moral, Political, and Literary"),
        ],
    },
    {
        "id": "leibniz",
        "name": "Gottfried Wilhelm Leibniz",
        "kind": "philosophe",
        "lang": "de",
        "era": "1646–1716 · monadologie",
        "blurb": "Monades, harmonie, raison suffisante : le meilleur des mondes, à éprouver.",
        "wikipedia": "Gottfried Wilhelm Leibniz",
        "monogram": "GL",
        "books": [
            (17147, "Theodicy"),
            (33849, "The Monadology"),
            (20162, "Discourse on Metaphysics"),
            (26839, "New Essays Concerning Human Understanding"),
            (17147, "Theodicy"),
        ],
    },
    {
        "id": "pascal",
        "name": "Blaise Pascal",
        "kind": "philosophe",
        "lang": "fr",
        "era": "1623–1662 · Port-Royal",
        "blurb": "Le roseau pensant, le pari, les deux infinis. Une clarté qui tremble.",
        "wikipedia": "Blaise Pascal",
        "monogram": "BP",
        "books": [
            (18269, "Pensées"),
            (18268, "Les Provinciales"),
            (4707, "Pascal's Pensées"),
            (18269, "Pensées"),
            (6001, "Thoughts of Blaise Pascal"),
        ],
    },
    {
        "id": "berkeley",
        "name": "George Berkeley",
        "kind": "philosophe",
        "lang": "en",
        "era": "1685–1753 · immatérialisme",
        "blurb": "Être, c’est être perçu. Les idées, Dieu, et le monde qui ne s’effondre pas.",
        "wikipedia": "George Berkeley",
        "monogram": "GB",
        "books": [
            (4723, "A Treatise Concerning the Principles of Human Knowledge"),
            (4724, "Three Dialogues between Hylas and Philonous"),
            (39706, "An Essay Towards a New Theory of Vision"),
            (4723, "Principles of Human Knowledge"),
            (11824, "Alciphron"),
        ],
    },
    {
        "id": "hegel",
        "name": "Georg Wilhelm Friedrich Hegel",
        "kind": "philosophe",
        "lang": "de",
        "era": "1770–1831 · dialectique",
        "blurb": "Le concept se meut. Histoire, droit, esprit : ce qui se nie pour se reprendre.",
        "wikipedia": "Georg Wilhelm Friedrich Hegel",
        "monogram": "GH",
        "books": [
            (12044, "The Philosophy of History"),
            (55108, "The Logic of Hegel"),
            (48147, "Philosophy of Right"),
            (12044, "Lectures on the Philosophy of History"),
            (55647, "The Phenomenology of Mind"),
        ],
    },
    {
        "id": "schopenhauer",
        "name": "Arthur Schopenhauer",
        "kind": "philosophe",
        "lang": "de",
        "era": "1788–1860 · volonté",
        "blurb": "Le monde comme représentation, puis comme volonté. La pitié, la musique, le renoncement.",
        "wikipedia": "Arthur Schopenhauer",
        "monogram": "AS",
        "books": [
            (38427, "The World as Will and Idea (Vol. 1)"),
            (40097, "The World as Will and Idea (Vol. 2)"),
            (10732, "Studies in Pessimism"),
            (11945, "The Art of Literature"),
            (10833, "The Essays of Arthur Schopenhauer"),
        ],
    },
    {
        "id": "kierkegaard",
        "name": "Søren Kierkegaard",
        "kind": "philosophe",
        "lang": "da",
        "era": "1813–1855 · existence",
        "blurb": "L’angoisse, le saut, le particulier face à l’universel. Pas de système qui tienne.",
        "wikipedia": "Søren Kierkegaard",
        "monogram": "SK",
        "books": [
            (57787, "Fear and Trembling"),
            (26416, "Selections from the Writings of Kierkegaard"),
            (60333, "The Sickness Unto Death"),
            (57787, "Fear and Trembling"),
            (26416, "Kierkegaard Selections"),
        ],
    },
    {
        "id": "mill",
        "name": "John Stuart Mill",
        "kind": "philosophe",
        "lang": "en",
        "era": "1806–1873 · libéralisme",
        "blurb": "Harm to others, utilité, liberté de penser. Le particulier contre la tyrannie de la majorité.",
        "wikipedia": "John Stuart Mill",
        "monogram": "JM",
        "books": [
            (34901, "On Liberty"),
            (11224, "Utilitarianism"),
            (47001, "The Subjection of Women"),
            (30107, "Considerations on Representative Government"),
            (10378, "A System of Logic"),
        ],
    },
    {
        "id": "emerson",
        "name": "Ralph Waldo Emerson",
        "kind": "philosophe",
        "lang": "en",
        "era": "1803–1882 · transcendantalisme",
        "blurb": "Self-reliance, nature, l’âme en plein air. Une maxime, puis le risque de la vivre.",
        "wikipedia": "Ralph Waldo Emerson",
        "monogram": "RE",
        "books": [
            (16643, "Essays — First Series"),
            (2944, "Essays — Second Series"),
            (2945, "Nature"),
            (16643, "Self-Reliance"),
            (12893, "The Conduct of Life"),
        ],
    },
    {
        "id": "james",
        "name": "William James",
        "kind": "philosophe",
        "lang": "en",
        "era": "1842–1910 · pragmatisme",
        "blurb": "La vérité se vérifie à l’usage. L’expérience religieuse, la volonté de croire.",
        "wikipedia": "William James",
        "monogram": "WJ",
        "books": [
            (11984, "Pragmatism"),
            (621, "The Varieties of Religious Experience"),
            (16287, "The Will to Believe"),
            (11005, "Psychology"),
            (37423, "Essays in Radical Empiricism"),
        ],
    },
    {
        "id": "diderot",
        "name": "Denis Diderot",
        "kind": "philosophe",
        "lang": "fr",
        "era": "1713–1784 · Encyclopédie",
        "blurb": "Le dialogue qui dérange, le matérialisme gai, l’atelier des savoirs.",
        "wikipedia": "Denis Diderot",
        "monogram": "DD",
        "books": [
            (13846, "Le Neveu de Rameau"),
            (9289, "La Religieuse"),
            (12564, "Lettre sur les aveugles"),
            (9606, "Jacques the Fatalist"),
            (16341, "Rameau's Nephew"),
        ],
    },
    {
        "id": "christianisme",
        "name": "La Bible",
        "kind": "tradition",
        "lang": "he",
        "era": "Écritures · christianisme",
        "blurb": "Alliance, évangile, psalmiste : une parole qui se relit. Le symbole : la croix.",
        "wikipedia": "Bible",
        "monogram": "✝",
        "avatar": "/salon/avatars/christianisme.svg",
        "books": [
            (10, "The King James Bible"),
            (8300, "The Douay-Rheims Bible"),
            (10703, "The New Testament"),
            (1653, "The Imitation of Christ"),
            (7987, "The Book of Psalms"),
        ],
    },
    {
        "id": "judaisme",
        "name": "La Torah",
        "kind": "tradition",
        "lang": "he",
        "era": "Écritures · judaïsme",
        "blurb": "Loi, prophètes, ketouvim : une alliance lue et relue. Le symbole : l’étoile de David.",
        "wikipedia": "Torah",
        "monogram": "✡",
        "avatar": "/salon/avatars/judaisme.svg",
        "books": [
            (28268, "The Holy Scriptures (JPS 1917)"),
            (8486, "The Pentateuch"),
            (7987, "The Book of Psalms"),
            (15143, "Proverbs"),
            (1252, "Isaiah"),
        ],
    },
    {
        "id": "islam",
        "name": "Le Coran",
        "kind": "tradition",
        "lang": "ar",
        "era": "Écritures · islam",
        "blurb": "Une récitation, une loi, une miséricorde. Le symbole : le croissant.",
        "wikipedia": "Quran",
        "monogram": "☪",
        "avatar": "/salon/avatars/islam.svg",
        "books": [
            (7440, "The Qur'ân (Palmer)"),
            (2800, "The Koran (Rodwell)"),
            (3434, "The Koran (Sale)"),
            (16955, "The Qur'an (Wherry)"),
            (2800, "The Koran"),
        ],
    },
    {
        "id": "hindouisme",
        "name": "La Bhagavad-Gîtâ",
        "kind": "tradition",
        "lang": "sa",
        "era": "Écritures · hindouisme",
        "blurb": "Le champ, le devoir, le yoga. Krishna parle à Arjuna. Le symbole : Om.",
        "wikipedia": "Bhagavad Gita",
        "monogram": "ॐ",
        "avatar": "/salon/avatars/hindouisme.svg",
        "books": [
            (2388, "The Bhagavadgita"),
            (12080, "The Bhagavad Gita"),
            (12384, "The Upanishads"),
            (3283, "The Vedanta-Sutras"),
            (3017, "Hindu Literature"),
        ],
    },
    {
        "id": "bouddhisme",
        "name": "Le Dhammapada",
        "kind": "tradition",
        "lang": "pi",
        "era": "Écritures · bouddhisme",
        "blurb": "L’esprit précède tout. Une strophe, une voie. Le symbole : la roue du Dharma.",
        "wikipedia": "Dhammapada",
        "monogram": "☸",
        "avatar": "/salon/avatars/bouddhisme.svg",
        "books": [
            (2017, "The Dhammapada"),
            (351, "Buddhist Suttas"),
            (15816, "The Gospel of Buddha"),
            (2018, "Buddhism and Buddhists"),
            (12516, "The Buddha's Way of Virtue"),
        ],
    },
    {
        "id": "taoisme",
        "name": "Le Tao-Tö-King",
        "kind": "tradition",
        "lang": "zh",
        "era": "Écritures · taoïsme",
        "blurb": "La voie qui ne se nomme pas. Souple, obscure, exacte. Le symbole : yin et yang.",
        "wikipedia": "Tao Te Ching",
        "monogram": "☯",
        "avatar": "/salon/avatars/taoisme.svg",
        "books": [
            (216, "Tao Te Ching"),
            (4991, "The Tao Teh King"),
            (727, "The Writings of Chuang Tzu"),
            (310, "The Sayings of Lao Tzu"),
            (17400, "Taoist Teachings from the Book of Lieh Tzü"),
        ],
    },
]


def fetch(url: str, timeout: int = 25) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/plain,application/json,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read()
    except Exception as exc:
        print(f"  skip {url} ({exc})")
        return None


def gutenberg_txt(book_id: int) -> str | None:
    raw = fetch(f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt")
    if not raw:
        return None
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            text = None
    if not text:
        return None
    text = re.sub(r"\u0000", "", text)
    start = re.search(r"\*\*\*\s*START OF.+?\*\*\*", text, re.I)
    end = re.search(r"\*\*\*\s*END OF.+?\*\*\*", text, re.I)
    if start:
        text = text[start.end() :]
    if end:
        text = text[: end.start()]
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) > 4000 else None


def terms_of(text: str, n: int = 12) -> list[str]:
    freq: dict[str, int] = {}
    for token in re.findall(r"[\w’'-]{4,}", text.lower(), re.UNICODE):
        key = re.sub(r"[’'-]", "", token)
        if len(key) < 4:
            continue
        freq[key] = freq.get(key, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda kv: -kv[1])[:n]]


def pack_work(title: str, book_id: int, text: str) -> tuple[dict, list[dict]]:
    url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
    sample = text[:280]
    work = {
        "title": title,
        "url": url,
        "source": "gutenberg",
        "ok": True,
        "chars": len(text),
        "sample": sample,
        "terms": terms_of(text, 12),
    }
    passages = []
    clipped = text[:80_000]
    for i in range(0, min(len(clipped), 7200), 720):
        piece = clipped[i : i + 900].strip()
        if len(piece) < 120:
            continue
        passages.append(
            {
                "id": f"pg{book_id}_{len(passages)}",
                "work": title,
                "text": piece,
                "terms": terms_of(piece, 8),
            }
        )
        if len(passages) >= 8:
            break
    return work, passages


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn").lower()


SKIP = {"von", "van", "der", "den", "des", "saint", "san", "jean", "john", "karl", "william"}


def authored_by(person: str, authors: str) -> bool:
    tokens = [t for t in re.findall(r"[a-z]{3,}", fold(person)) if t not in SKIP]
    blob = fold(authors)
    names = re.findall(r"[a-z]{3,}", blob)
    for token in tokens:
        if token in blob:
            return True
        if any(n.startswith(token) or token.startswith(n) for n in names if len(n) >= 4):
            return True
    return False


def gutendex_search(name: str, limit: int = 8) -> list[tuple[int, str]]:
    url = "https://gutendex.com/books?search=" + urllib.parse.quote(name)
    raw = fetch(url, timeout=18)
    if not raw:
        return []
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return []
    out = []
    seen = set()
    for book in data.get("results") or []:
        title = str(book.get("title") or "").strip()
        bid = book.get("id")
        authors = ", ".join(a.get("name") or "" for a in book.get("authors") or [])
        if not bid or not title or NOISE.search(title):
            continue
        if not authored_by(name, authors):
            continue
        if title.lower() in seen:
            continue
        seen.add(title.lower())
        out.append((int(bid), title))
        if len(out) >= limit:
            break
    return out


def ingest_books(pairs: list[tuple[int, str]], already: set[str]) -> tuple[list[dict], list[dict]]:
    works, passages = [], []
    for book_id, title in pairs:
        key = title.lower().strip()
        if key in already or NOISE.search(title):
            continue
        text = gutenberg_txt(book_id)
        time.sleep(0.25)
        if not text:
            continue
        work, more = pack_work(title, book_id, text)
        already.add(key)
        works.append(work)
        passages.extend(more)
        print(f"    + {title[:60]} ({len(text)} c)")
        if len(works) >= 5:
            break
    return works, passages


def author_record(spec: dict, works: list[dict], passages: list[dict]) -> dict:
    words = sum(len(p["text"].split()) for p in passages)
    terms = []
    seen = set()
    for work in works:
        for t in work.get("terms") or []:
            if t not in seen:
                seen.add(t)
                terms.append(t)
    sample = next((w.get("sample") for w in works if w.get("sample")), "")
    rec = {
        "id": spec["id"],
        "name": spec["name"],
        "kind": spec["kind"],
        "lang": spec["lang"],
        "era": spec["era"],
        "blurb": spec["blurb"],
        "wikipedia": spec["wikipedia"],
        "avatar": spec.get("avatar") or f"/salon/avatars/{spec['id']}.svg",
        "monogram": spec["monogram"],
        "works": works,
        "works_count": len(works),
        "terms": terms[:16],
        "stats": {"words": words, "distinct": len(seen)},
        "sample": sample,
    }
    return rec


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text())
    corpus = json.loads(CORPUS_PATH.read_text())
    by_id = {a["id"]: a for a in catalog["authors"]}

    if "tradition" not in catalog["kinds"]:
        catalog["kinds"].append("tradition")

    print("— keep the 28 (already Gutenberg) —")
    print("authors in catalogue:", len(catalog["authors"]))

    print("— new philosophers and traditions —")
    for spec in NEW_AUTHORS:
        if spec["id"] in by_id and spec["id"] not in ("christianisme", "judaisme", "islam", "hindouisme", "bouddhisme", "taoisme"):
            print(f"  skip existing {spec['id']}")
            continue
        have: set[str] = set()
        works, passages = ingest_books(spec["books"], have)
        if len(works) < 3:
            more = gutendex_search(spec["name"], 8)
            extra, extra_p = ingest_books(more, have)
            works.extend(extra)
            passages.extend(extra_p)
        if len(works) < 3:
            print(f"  WARN {spec['id']}: only {len(works)} works")
            if not works:
                continue
        rec = author_record(spec, works, passages)
        if spec["id"] in by_id:
            # replace tradition stubs if any
            catalog["authors"] = [a for a in catalog["authors"] if a["id"] != spec["id"]]
        catalog["authors"].append(rec)
        corpus[spec["id"]] = {
            "passages": passages,
            "terms": rec["terms"],
            "sample": rec["sample"],
        }
        by_id[spec["id"]] = rec
        print(f"  {spec['id']}: {len(works)} works, {len(passages)} passages")

    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    CORPUS_PATH.write_text(json.dumps(corpus, ensure_ascii=False) + "\n")
    print("authors", len(catalog["authors"]))
    print("wrote", CATALOG_PATH, CORPUS_PATH)


if __name__ == "__main__":
    main()
