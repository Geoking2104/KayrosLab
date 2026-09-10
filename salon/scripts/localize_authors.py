#!/usr/bin/env python3
"""Add nameEn / blurbEn / eraEn to catalog.json and emit a compact authors pack."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "src/lib/salon/catalog.json"
PACK = ROOT / "src/lib/salon/authors-pack.json"

NAME_EN = {
    "aristote": "Aristotle",
    "augustin": "Augustine of Hippo",
    "boece": "Boethius",
    "ciceron": "Cicero",
    "dostoevski": "Fyodor Dostoevsky",
    "tolstoi": "Leo Tolstoy",
    "marcaurele": "Marcus Aurelius",
    "cervantes": "Miguel de Cervantes",
    "machiavel": "Niccolò Machiavelli",
    "platon": "Plato",
    "seneca": "Seneca",
    "aquinas": "Thomas Aquinas",
    "epictete": "Epictetus",
    "epicure": "Epicurus",
    "hindouisme": "The Bhagavad Gita",
    "christianisme": "The Bible",
    "judaisme": "The Torah",
    "islam": "The Quran",
    "bouddhisme": "The Dhammapada",
    "taoisme": "The Tao Te Ching",
}

ERA_EN = {
    "1723–1790 · économie politique": "1723–1790 · political economy",
    "–322 av. J.-C. · antique": "d. 322 BCE · antiquity",
    "1632–1677 · rationalisme": "1632–1677 · rationalism",
    "1809–1882 · sciences": "1809–1882 · natural science",
    "–479 av. J.-C. · antique": "d. 479 BCE · antiquity",
    "1809–1849 · fantastique": "1809–1849 · the fantastic",
    "1724–1804 · idéalisme": "1724–1804 · idealism",
    "1821–1881 · roman psychologique": "1821–1881 · psychological novel",
    "1883–1924 · modernité": "1883–1924 · modernity",
    "1844–1900 · modernité": "1844–1900 · modernity",
    "1799–1850 · réalisme": "1799–1850 · realism",
    "1775–1817 · roman de mœurs": "1775–1817 · novel of manners",
    "1712–1778 · Lumières": "1712–1778 · Enlightenment",
    "1828–1905 · aventure scientifique": "1828–1905 · scientific adventure",
    "1818–1883 · critique sociale": "1818–1883 · social critique",
    "1828–1910 · réalisme": "1828–1910 · realism",
    "121–180 · stoïcisme": "121–180 · Stoicism",
    "1533–1592 · humanisme (trad. anglaise)": "1533–1592 · humanism",
    "1547–1616 · roman moderne": "1547–1616 · the modern novel",
    "1469–1527 · Renaissance": "1469–1527 · Renaissance",
    "1854–1900 · esthétisme": "1854–1900 · aestheticism",
    "–348 av. J.-C. · antique": "d. 348 BCE · antiquity",
    "1596–1650 · rationalisme": "1596–1650 · rationalism",
    "1783–1842 · réalisme": "1783–1842 · realism",
    "VIe s. av. J.-C. · stratégies": "6th c. BCE · strategy",
    "1802–1885 · romantisme": "1802–1885 · Romanticism",
    "1694–1778 · Lumières": "1694–1778 · Enlightenment",
    "1564–1616 · Renaissance": "1564–1616 · Renaissance",
    "4 av. J.-C.–65 · stoïcisme": "4 BCE–65 · Stoicism",
    "106–43 av. J.-C. · République": "106–43 BCE · the Republic",
    "50–135 · stoïcisme": "50–135 · Stoicism",
    "341–270 av. J.-C. · Jardin": "341–270 BCE · the Garden",
    "354–430 · patristique": "354–430 · patristics",
    "480–524 · consolation": "480–524 · consolation",
    "1225–1274 · scolastique": "1225–1274 · scholasticism",
    "1588–1679 · contrat": "1588–1679 · the social contract",
    "1632–1704 · empirisme": "1632–1704 · empiricism",
    "1711–1776 · Lumières écossaises": "1711–1776 · Scottish Enlightenment",
    "1646–1716 · monadologie": "1646–1716 · monadology",
    "1623–1662 · Port-Royal": "1623–1662 · Port-Royal",
    "1685–1753 · immatérialisme": "1685–1753 · immaterialism",
    "1770–1831 · dialectique": "1770–1831 · dialectic",
    "1788–1860 · volonté": "1788–1860 · the will",
    "1813–1855 · existence": "1813–1855 · existence",
    "1806–1873 · libéralisme": "1806–1873 · liberalism",
    "1803–1882 · transcendantalisme": "1803–1882 · transcendentalism",
    "1842–1910 · pragmatisme": "1842–1910 · pragmatism",
    "1713–1784 · Encyclopédie": "1713–1784 · the Encyclopédie",
    "Écritures · christianisme": "Scripture · Christianity",
    "Écritures · judaïsme": "Scripture · Judaism",
    "Écritures · islam": "Scripture · Islam",
    "Écritures · hindouisme": "Scripture · Hinduism",
    "Écritures · bouddhisme": "Scripture · Buddhism",
    "Écritures · taoïsme": "Scripture · Taoism",
}

BLURB_EN = {
    "smith": "Markets, the division of labour, and incidence: what exchange produces and what it wears down.",
    "aristote": "Virtue as a mean, practical prudence, and a strict classification of what can be known.",
    "spinoza": "Understand in order to stop suffering: causes, necessity, active joy against the passions.",
    "darwin": "Selection by ordeal: variation, the constraints of a milieu, survival without a guarantee.",
    "confucius": "Trust, the example set by those in charge, and constancy before force.",
    "poe": "Logic driven to obsession: what can go wrong does, and the mind watches itself fail.",
    "kant": "The categorical imperative: treat no one as a mere means; universalise the maxim.",
    "dostoevski": "What a fixed idea does to the one who carries it: guilt, transgression, compassion.",
    "kafka": "Procedures that absorb people: warning signals about bureaucracy and the unread letter.",
    "nietzsche": "Suspect the values already installed: will, the courage to think against, creation after the no.",
    "balzac": "The pitiless observer of appetite, money, and social ambition.",
    "austen": "Interests hidden under manners: reading people, their calculations, and their pride.",
    "rousseau": "Education by experience, the social contract, and the price of civilisation.",
    "verne": "Technique in the service of exploration: engineering, risk, and unknown lands.",
    "marx": "Relations of force and labour: who bears the real cost, who captures the value.",
    "tolstoi": "War and the peace of great decisions: plans on one side, the real on the other.",
    "marcaurele": "The stoicism of the one who governs: distinguish what depends on you, act without noise.",
    "montaigne": "The essay as method: judge for yourself, doubt, compare — “what do I know?”",
    "cervantes": "The gap between the project and the world: the idealist judged by facts, and vice versa.",
    "machiavel": "Power as it is: fortuna, occasion, credibility — neither cheap cynicism nor consolation.",
    "wilde": "Wit that unpicks vanity from desire: the price of appearance and of the will.",
    "platon": "Dialogue as method: definitions put to the test, allegories, justice examined.",
    "descartes": "Methodical doubt: divide the problem, examine the proofs, conclude only on what is clear.",
    "stendhal": "The calculus of the heart and of ambition: social ascent seen from inside.",
    "suntzu": "Win without fighting: position, timing, information — conflict as a last resort.",
    "hugo": "The social fresco and the voice of the humble: misery, justice, revolt, and hope.",
    "voltaire": "Irony against dogma: naïve optimism tried by the real, tolerance, lucidity.",
    "shakespeare": "Ambition, betrayal, and fates that turn: every decision has its soliloquy and its price.",
    "seneca": "Time, anger, constancy: a daily exercise, without cheap consolation.",
    "ciceron": "Eloquence as a civic duty: friendship, offices, and the res publica.",
    "epictete": "What depends on you, what does not. A distinction, then the use of it.",
    "epicure": "Pleasure as the absence of trouble. Atoms, friendship, death that is nothing to us.",
    "augustin": "Memory, time, grace: a man who examines himself as far as God.",
    "boece": "Fortune, freedom, the sovereign good: philosophy visits the prison.",
    "aquinas": "Distinguish in order to unite: act, potency, and what reason can say of God.",
    "hobbes": "Fear, the pact, Leviathan: peace as an artifice.",
    "locke": "Understanding, property, toleration: what experience authorises.",
    "hume": "Custom, causality, sympathy: a scepticism that goes on living.",
    "leibniz": "Monads, harmony, sufficient reason: the best of worlds, to be put to the test.",
    "pascal": "The thinking reed, the wager, the two infinities. A clarity that trembles.",
    "berkeley": "To be is to be perceived. Ideas, God, and a world that does not collapse.",
    "hegel": "The concept moves. History, right, spirit: what negates itself in order to take itself up.",
    "schopenhauer": "The world as representation, then as will. Pity, music, renunciation.",
    "kierkegaard": "Anxiety, the leap, the particular facing the universal. No system holds.",
    "mill": "Harm to others, utility, freedom of thought. The particular against the tyranny of the majority.",
    "emerson": "Self-reliance, nature, the soul in the open air. A maxim, then the risk of living it.",
    "james": "Truth verifies itself in use. Religious experience, the will to believe.",
    "diderot": "The dialogue that unsettles, cheerful materialism, the workshop of knowledges.",
    "christianisme": "Covenant, gospel, psalmist: a word that is read again. The sign: the cross.",
    "judaisme": "Law, prophets, ketuvim: a covenant read and reread. The sign: the Star of David.",
    "islam": "A recitation, a law, a mercy. The sign: the crescent.",
    "hindouisme": "The field, duty, yoga. Krishna speaks to Arjuna. The sign: Om.",
    "bouddhisme": "Mind precedes all. A stanza, a path. The sign: the dharma wheel.",
    "taoisme": "The way that is not named. Supple, obscure, exact. The sign: yin and yang.",
}

ELENCHUS = {"voltaire", "platon", "socrates", "kierkegaard"}


def main() -> None:
    data = json.loads(CATALOG.read_text())
    pack = []
    missing_blurb = []
    missing_era = []
    for author in data["authors"]:
        aid = author["id"]
        author["nameEn"] = NAME_EN.get(aid, author["name"])
        blurb_en = BLURB_EN.get(aid)
        if not blurb_en:
            missing_blurb.append(aid)
            blurb_en = author["blurb"]
        author["blurbEn"] = blurb_en
        era_en = ERA_EN.get(author["era"])
        if not era_en:
            missing_era.append((aid, author["era"]))
            era_en = author["era"]
        author["eraEn"] = era_en
        works = [w["title"] for w in author.get("works", []) if w.get("ok", True)][:5]
        pack.append(
            {
                "id": aid,
                "name": author["name"],
                "nameEn": author["nameEn"],
                "kind": author["kind"],
                "blurb": author["blurb"],
                "blurbEn": author["blurbEn"],
                "era": author["era"],
                "eraEn": author["eraEn"],
                "avatar": author.get("avatar") or "",
                "monogram": author.get("monogram") or author["name"][:1],
                "method": "elenchus" if aid in ELENCHUS else "auto",
                "works": works,
            }
        )
    pack.sort(key=lambda a: a["nameEn"].lower())
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    PACK.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    print("authors", len(pack), "missing blurb", missing_blurb, "missing era", missing_era)


if __name__ == "__main__":
    main()
