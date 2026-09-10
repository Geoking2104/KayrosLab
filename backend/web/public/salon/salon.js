/* Salon — static foyer & séance. Protocol mirrors crates/salon-core. */
(function () {
  "use strict";

  const KEY = "kayros-salon-v1";
  const ROLE_FR = {
    hote: "Hôte",
    lecteur: "Lecteur",
    objecteur: "Objecteur",
    secretaire: "Secrétaire",
    invite: "Invité",
  };
  const KIND_FR = {
    lecture: "Lecture",
    objection: "Objection",
    defense: "Défense",
    concession: "Concession",
    synthese: "Synthèse",
    minute: "Minute",
  };
  const VERDICT_FR = { tenir: "Tenir", relire: "Relire", laisser: "Laisser" };
  const KIND_PROMPT = {
    lecture: "Le texte d’abord. Lisez, ou dites ce que le passage exige — et citez.",
    objection: "Où le texte force-t-il trop ? L’objection sans lieu dans le passage ne compte pas.",
    defense: "Que faut-il tenir, malgré l’objection ? Répondez sans la diluer.",
    concession: "Accordez, nuançez, ou ouvrez un second front. Restez dans le texte.",
    synthese: "L’hôte clôt : ce que le cercle retient, en une seule tenue.",
    minute: "Le secrétaire consigne ce qui a été dit, non ce qu’on aurait voulu dire.",
  };

  const SEED = [
    {
      id: "port-royal",
      name: "Port-Royal",
      place: "Paris",
      tradition: "philosophie",
      statement:
        "On lit Pascal comme on tient une objection : jusqu’au bout, sans la fondre dans une consolation.",
      members: [
        { id: "m-helene", name: "Hélène Vasseur", role: "hote" },
        { id: "m-marc", name: "Marc Delorme", role: "lecteur" },
        { id: "m-ina", name: "Ina Koltès", role: "objecteur" },
        { id: "m-paul", name: "Paul Meynier", role: "secretaire" },
      ],
      work: {
        title: "Pensées",
        author: "Blaise Pascal",
        year: "1670",
        excerpt:
          "Le cœur a ses raisons, que la raison ne connaît point ; on le sait en mille choses. Je dis que le cœur aime l’être universel naturellement, et soi-même naturellement, selon qu’il s’y adonne ; et il se durcit contre l’un ou l’autre à son choix.",
        source: "Lafuma 423 · Brunschvicg 277",
      },
      turns: [
        {
          id: "t-pr-1",
          memberId: "m-marc",
          role: "lecteur",
          kind: "lecture",
          text: "Pascal n’oppose pas le sentiment à la preuve. Il nomme une autre prise : « Le cœur a ses raisons, que la raison ne connaît point. » La raison n’est pas congédiée ; elle est bornée.",
          hasCitation: true,
          createdAt: "2026-09-03T19:10:00.000Z",
        },
        {
          id: "t-pr-2",
          memberId: "m-ina",
          role: "objecteur",
          kind: "objection",
          text: "« on le sait en mille choses » est trop facile. Si le cœur se durcit « à son choix », l’argument autorise n’importe quelle adhésion. Où est le critère, hors du fragment ?",
          hasCitation: true,
          createdAt: "2026-09-03T19:18:00.000Z",
        },
      ],
      minute: null,
    },
    {
      id: "chambre-du-haut",
      name: "Chambre du haut",
      place: "Londres",
      tradition: "lettres",
      statement:
        "Une chambre n’est pas un confort. C’est la condition matérielle d’une phrase qui n’a pas à demander pardon.",
      members: [
        { id: "m-clara", name: "Clara Nesbit", role: "hote" },
        { id: "m-lea", name: "Léa Hovannessian", role: "lecteur" },
        { id: "m-theo", name: "Théo Bresson", role: "objecteur" },
        { id: "m-nadia", name: "Nadia El Khoury", role: "secretaire" },
        { id: "m-june", name: "June Adler", role: "invite" },
      ],
      work: {
        title: "A Room of One’s Own",
        author: "Virginia Woolf",
        year: "1929",
        excerpt:
          "A woman must have money and a room of her own if she is to write fiction. […] Fiction is like a spider’s web, attached ever so lightly perhaps, but still attached to life at all four corners.",
        source: "Chapter 1 · Chapter 3",
      },
      turns: [
        {
          id: "t-ch-1",
          memberId: "m-lea",
          role: "lecteur",
          kind: "lecture",
          text: "Woolf pose d’abord la condition, ensuite la métaphore. « money and a room of her own » n’est pas une image : c’est un budget. La toile d’araignée vient après, pour dire que même alors la fiction tient à la vie « at all four corners ».",
          hasCitation: true,
          createdAt: "2026-09-06T16:02:00.000Z",
        },
      ],
      minute: null,
    },
    {
      id: "mercredi-nantes",
      name: "Cercle du mercredi",
      place: "Nantes",
      tradition: "philosophie",
      statement: "On lit Montaigne sans le ramener à nos mœurs. Le cannibale n’est pas un décor.",
      members: [
        { id: "m-yan", name: "Yann Prigent", role: "hote" },
        { id: "m-soizic", name: "Soizic Le Bihan", role: "lecteur" },
        { id: "m-elias", name: "Elias Karem", role: "objecteur" },
        { id: "m-maude", name: "Maude Ferrand", role: "secretaire" },
      ],
      work: {
        title: "Des cannibales",
        author: "Michel de Montaigne",
        year: "1580",
        excerpt:
          "Je trouve qu’il n’y a rien de barbare et de sauvage en cette nation, à ce qu’on m’en a rapporté, sinon que chacun appelle barbarie ce qui n’est pas de son usage. […] Nous les pouvons donc bien appeler barbares, eu égard aux règles de la raison, mais non pas eu égard à nous, qui les surpassons en toute sorte de barbarie.",
        source: "Essais, I, 31",
      },
      turns: [],
      minute: null,
    },
  ];

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (ch) {
      if (ch === "&") return "\u0026amp;";
      if (ch === "<") return "\u0026lt;";
      if (ch === ">") return "\u0026gt;";
      if (ch === '"') return "\u0026quot;";
      return "\u0026#39;";
    });
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function hasCitation(text) {
    return /[«""].+[»""]/.test(text) || /\b(p\.|§|fr\.|fragment)\s*\d+/i.test(text);
  }

  function loadCircles() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(SEED);
      const parsed = JSON.parse(raw);
      const circles = parsed.circles || (parsed.state && parsed.state.circles);
      if (Array.isArray(circles) && circles.length) return circles;
    } catch (_) {}
    return structuredClone(SEED);
  }

  function saveCircles(circles) {
    localStorage.setItem(KEY, JSON.stringify({ circles }));
  }

  function hasRole(members, role) {
    return members.some((m) => m.role === role);
  }

  function nextAfter(kind) {
    switch (kind) {
      case "lecture":
        return { role: "objecteur", kind: "objection" };
      case "objection":
        return { role: "lecteur", kind: "defense" };
      case "defense":
        return { role: "invite", kind: "concession" };
      case "concession":
        return { role: "hote", kind: "synthese" };
      case "synthese":
        return { role: "secretaire", kind: "minute" };
      case "minute":
        return { role: "hote", kind: "synthese" };
      default:
        return { role: "lecteur", kind: "lecture" };
    }
  }

  function adjustNext(members, role, kind) {
    if (hasRole(members, role)) return { role, kind };
    if (role === "invite") {
      if (hasRole(members, "hote")) return { role: "hote", kind: "synthese" };
      return { role: "lecteur", kind: "defense" };
    }
    if (role === "objecteur") return { role: "hote", kind: "objection" };
    if (role === "secretaire") return { role: "hote", kind: "minute" };
    return { role, kind };
  }

  function evaluateFallback(input) {
    const nMembers = Math.max(input.members.length, 1);
    const spoken = [...new Set(input.turns.map((t) => t.role))];
    const polyphony = Math.min(1, spoken.length / nMembers);
    const objections = input.turns.filter((t) => t.kind === "objection").length;
    const defenses = input.turns.filter(
      (t) => t.kind === "defense" || t.kind === "concession" || t.kind === "synthese",
    ).length;
    const tension =
      objections === 0 ? 0.12 : Math.min(1, objections / Math.max(objections + defenses, 1));
    const cited = input.turns.filter((t) => t.has_citation).length;
    const fidelity = input.turns.length === 0 ? 0 : Math.min(1, cited / input.turns.length);
    const hasSynthese = input.turns.some((t) => t.kind === "synthese");
    const hasMinute = input.turns.some((t) => t.kind === "minute");
    const closure =
      hasSynthese && hasMinute
        ? 0.92
        : hasSynthese
          ? 0.55
          : hasMinute
            ? 0.4
            : Math.min(0.35, input.turns.length / 8);

    const nxt = input.turns.length
      ? (function () {
          const last = input.turns[input.turns.length - 1];
          const n = nextAfter(last.kind);
          return adjustNext(input.members, n.role, n.kind);
        })()
      : adjustNext(input.members, "lecteur", "lecture");

    let verdict = null;
    if (input.turns.length >= 3) {
      if (hasMinute && polyphony >= 0.66 && tension <= 0.45 && fidelity >= 0.4) verdict = "tenir";
      else if (tension >= 0.7 || fidelity < 0.25) verdict = "relire";
      else if (hasSynthese && polyphony < 0.5) verdict = "laisser";
      else if (hasMinute) verdict = "relire";
    }

    const notes = {
      lecture: "Le lecteur ouvre — le texte d’abord, le commentaire ensuite.",
      objection: "L’objecteur doit citer. Une objection sans lieu dans le texte ne compte pas.",
      defense: "Le lecteur (ou l’hôte) répond sans diluer l’objection.",
      concession: "Un invité peut accorder, nuancer, ou ouvrir un second front.",
      synthese: "L’hôte clôt : ce que le cercle retient, en une seule tenue.",
      minute: "Le secrétaire écrit ce qui a été dit, non ce qu’on aurait voulu dire.",
    };
    const note =
      verdict === "tenir"
        ? "Le cercle peut tenir cette lecture. La minute la consigne."
        : verdict === "relire"
          ? "Trop d’objections ou trop peu de citations : on relit le passage."
          : verdict === "laisser"
            ? "La synthèse est venue trop tôt. On laisse ce texte pour une autre séance."
            : notes[nxt.kind];

    return {
      polyphony,
      tension,
      fidelity,
      closure,
      next_kind: nxt.kind,
      next_role: nxt.role,
      verdict,
      note,
    };
  }

  let wasm = null;
  let wasmTried = false;

  async function loadWasm() {
    if (wasmTried) return wasm;
    wasmTried = true;
    try {
      const res = await fetch("./salon_core.wasm");
      if (!res.ok) return null;
      let instance;
      try {
        ({ instance } = await WebAssembly.instantiateStreaming(res.clone(), {}));
      } catch (_) {
        const buf = await res.arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(buf, {}));
      }
      const exports = instance.exports;
      if (
        !exports.memory ||
        typeof exports.salon_heap !== "function" ||
        typeof exports.salon_out_off !== "function" ||
        typeof exports.salon_eval !== "function"
      ) {
        return null;
      }
      evalWith(exports, {
        members: [{ role: "lecteur" }, { role: "objecteur" }],
        turns: [],
      });
      wasm = exports;
      return wasm;
    } catch (_) {
      wasm = null;
      return null;
    }
  }

  function evalWith(instance, input) {
    const json = new TextEncoder().encode(JSON.stringify(input));
    const heapPtr = instance.salon_heap();
    const outOff = instance.salon_out_off();
    if (json.length > outOff) throw new Error("tas");
    new Uint8Array(instance.memory.buffer).set(json, heapPtr);
    const returned = instance.salon_eval(json.length);
    const absPtr = returned > outOff ? returned : heapPtr + outOff;
    const view = new DataView(instance.memory.buffer);
    const len = view.getUint32(absPtr, true);
    if (len < 2 || len > 24 * 1024) throw new Error("vide");
    const bytes = new Uint8Array(instance.memory.buffer, absPtr + 4, len);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed.next_kind || !parsed.next_role) throw new Error("incomplet");
    return parsed;
  }

  function circleToInput(circle) {
    return {
      members: circle.members.map((m) => ({ role: m.role })),
      turns: circle.turns.map((t) => ({
        role: t.role,
        kind: t.kind,
        text: t.text,
        has_citation: t.hasCitation,
      })),
    };
  }

  async function evaluateCircle(circle) {
    const input = circleToInput(circle);
    await loadWasm();
    if (!wasm) return { evaled: evaluateFallback(input), engine: "local" };
    try {
      return { evaled: evalWith(wasm, input), engine: "rust" };
    } catch (_) {
      return { evaled: evaluateFallback(input), engine: "local" };
    }
  }

  function speakerFor(circle, role) {
    return circle.members.find((m) => m.role === role) || circle.members[0];
  }

  function pct(n) {
    return String(Math.round(Number(n) * 100));
  }

  function renderFoyer() {
    const root = document.getElementById("salon-index");
    if (!root) return;
    const circles = loadCircles();
    root.innerHTML = circles
      .map(function (circle, index) {
        return (
          '<a href="seance.html?id=' +
          encodeURIComponent(circle.id) +
          '">' +
          '<span class="n">' +
          String(index + 1).padStart(2, "0") +
          "</span>" +
          "<div><em>" +
          esc(circle.name) +
          "</em><p>" +
          esc(circle.statement) +
          "</p></div>" +
          '<div class="meta">' +
          esc(circle.tradition) +
          " · " +
          esc(circle.place) +
          "<br>" +
          esc(circle.work.author) +
          ", <i>" +
          esc(circle.work.title) +
          "</i><br>" +
          circle.turns.length +
          " tour" +
          (circle.turns.length === 1 ? "" : "s") +
          "</div></a>"
        );
      })
      .join("");

    const form = document.getElementById("salon-create-form");
    const openBtn = document.getElementById("salon-open-form");
    const cancelBtn = document.getElementById("salon-cancel-form");
    if (openBtn && form) {
      openBtn.addEventListener("click", function () {
        form.hidden = false;
        openBtn.hidden = true;
        const first = form.querySelector("input");
        if (first) first.focus();
      });
    }
    if (cancelBtn && form && openBtn) {
      cancelBtn.addEventListener("click", function () {
        form.hidden = true;
        openBtn.hidden = false;
      });
    }
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const data = new FormData(form);
        const id = uid("cercle");
        const circle = {
          id,
          name: String(data.get("name") || "Cercle").trim(),
          place: String(data.get("place") || "—").trim() || "—",
          tradition: data.get("tradition") === "lettres" ? "lettres" : "philosophie",
          statement: String(data.get("statement") || "").trim(),
          members: [
            { id: uid("m"), name: String(data.get("host") || "Hôte").trim() || "Hôte", role: "hote" },
            { id: uid("m"), name: "Lecteur", role: "lecteur" },
            { id: uid("m"), name: "Objecteur", role: "objecteur" },
            { id: uid("m"), name: "Secrétaire", role: "secretaire" },
          ],
          work: {
            title: String(data.get("title") || "Sans titre").trim(),
            author: String(data.get("author") || "Anonyme").trim(),
            year: String(data.get("year") || "").trim(),
            excerpt: String(data.get("excerpt") || "").trim(),
            source: String(data.get("source") || "").trim(),
          },
          turns: [],
          minute: null,
        };
        const circlesNow = loadCircles();
        circlesNow.unshift(circle);
        saveCircles(circlesNow);
        window.location.href = "seance.html?id=" + encodeURIComponent(id);
      });
    }
  }

  async function renderSeance() {
    const stage = document.getElementById("salon-seance");
    if (!stage) return;
    const id = new URLSearchParams(window.location.search).get("id") || "";
    const circles = loadCircles();
    const circle = circles.find((c) => c.id === id);
    if (!circle) {
      stage.innerHTML =
        "<p>Ce cercle n’est plus convoqué.</p><a class=\"salon-back\" href=\"./\" >Retour aux cercles</a>";
      return;
    }
    const { evaled, engine } = await evaluateCircle(circle);
    const speaker = speakerFor(circle, evaled.next_role);

    const members = circle.members
      .map(function (member) {
        const next = evaled.next_role === member.role;
        return (
          "<li" +
          (next ? ' class="is-next"' : "") +
          "><strong>" +
          esc(member.name) +
          "</strong> · " +
          ROLE_FR[member.role] +
          (next ? " · à la parole" : "") +
          "</li>"
        );
      })
      .join("");

    const turns = circle.turns
      .map(function (turn) {
        const who = circle.members.find((m) => m.id === turn.memberId);
        return (
          '<article class="salon-turn' +
          (turn.invited ? " is-invited" : "") +
          '"><header><span>' +
          esc((who && who.name) || ROLE_FR[turn.role]) +
          " · " +
          KIND_FR[turn.kind] +
          "</span>" +
          (turn.invited ? "<span>voix invitée</span>" : "") +
          (turn.hasCitation ? "<span>citation</span>" : "<span>sans lieu</span>") +
          "</header><p>" +
          esc(turn.text) +
          "</p></article>"
        );
      })
      .join("");

    stage.innerHTML =
      '<a class="salon-back" href="./">← Cercles</a>' +
      '<div class="salon-seance" style="margin-top:1.5rem">' +
      '<aside class="salon-passage">' +
      '<p class="salon-kicker">' +
      esc(circle.tradition) +
      " · " +
      esc(circle.place) +
      "</p>" +
      "<div><h1 style=\"font-size:clamp(2rem,4vw,3.2rem);line-height:1.05;margin:0 0 0.4rem\">" +
      esc(circle.name) +
      "</h1><p style=\"margin:0;color:var(--ink-2)\">" +
      esc(circle.work.author) +
      ", <i>" +
      esc(circle.work.title) +
      "</i>" +
      (circle.work.year ? " · " + esc(circle.work.year) : "") +
      "</p></div>" +
      "<blockquote>« " +
      esc(circle.work.excerpt) +
      " »</blockquote>" +
      (circle.work.source ? '<p class="src">' + esc(circle.work.source) + "</p>" : "") +
      '<ul class="salon-members">' +
      members +
      "</ul>" +
      '<dl class="salon-colophon">' +
      "<div><dt>Polyphonie</dt><dd>" +
      pct(evaled.polyphony) +
      "</dd></div>" +
      "<div><dt>Tension</dt><dd>" +
      pct(evaled.tension) +
      "</dd></div>" +
      "<div><dt>Fidélité</dt><dd>" +
      pct(evaled.fidelity) +
      "</dd></div>" +
      "<div><dt>Clôture</dt><dd>" +
      pct(evaled.closure) +
      "</dd></div></dl>" +
      '<p class="salon-engine">Protocole ' +
      (engine === "rust" ? "Rust (salon_core.wasm)" : "local, même règles") +
      "</p></aside>" +
      '<section class="salon-thread">' +
      '<header class="salon-protocol">' +
      '<p class="salon-kicker">' +
      ROLE_FR[evaled.next_role] +
      " · " +
      KIND_FR[evaled.next_kind] +
      "</p>" +
      (evaled.verdict ? '<p class="salon-verdict">' + VERDICT_FR[evaled.verdict] + "</p>" : "") +
      "<p>" +
      esc(evaled.note) +
      "</p></header>" +
      turns +
      '<form class="salon-compose" id="salon-speak">' +
      "<label>" +
      esc(speaker.name) +
      ", " +
      esc(KIND_PROMPT[evaled.next_kind]) +
      '<textarea name="text" required minlength="12"></textarea></label>' +
      '<div class="row"><button class="salon-btn" type="submit">Prendre la parole</button></div>' +
      "</form></section></div>";

    const form = document.getElementById("salon-speak");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const text = String(new FormData(form).get("text") || "").trim();
      if (!text) return;
      circle.turns.push({
        id: uid("t"),
        memberId: speaker.id,
        role: speaker.role,
        kind: evaled.next_kind,
        text,
        hasCitation: hasCitation(text),
        createdAt: new Date().toISOString(),
      });
      if (evaled.next_kind === "minute") circle.minute = text;
      saveCircles(circles);
      void renderSeance();
    });
  }

  window.Salon = { renderFoyer, renderSeance };
})();
