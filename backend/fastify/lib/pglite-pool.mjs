// KayrosLab — Adaptateur PGlite -> interface `pg.Pool`.
//
// PGlite est PostgreSQL compile en WebAssembly : MEME moteur, memes triggers,
// memes contraintes, meme planificateur. Il sert ici a executer la recette sans
// serveur a installer. En production c'est `pg.Pool` qui est branche — les deux
// exposent la meme surface, c'est tout l'interet d'avoir isole le repository.
//
// Difference a connaitre : PGlite renvoie `affectedRows`, `pg` renvoie
// `rowCount`. C'est le seul ecart, et il est absorbe ici.

export function pgliteAsPool(db) {
  return {
    async query(text, values = []) {
      const r = await db.query(text, values);
      const rows = r.rows ?? [];
      return { rows, rowCount: rows.length || r.affectedRows || 0 };
    },
    async end() { return db.close?.(); },
  };
}
