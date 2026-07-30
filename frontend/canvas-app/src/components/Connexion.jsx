import { useState } from 'react';
import { useCanvas } from '../store.js';

/**
 * Ecran de connexion — affiche uniquement en mode distant.
 * En mode local, aucun jeton n'existe : il n'y a rien a saisir, et demander
 * une authentification pour un usage hors ligne n'aurait aucun sens.
 */
export default function Connexion() {
  const { connecter, message } = useCanvas();
  const [valeur, setValeur] = useState('');

  return (
    <div className="connexion">
      <form onSubmit={(e) => { e.preventDefault(); connecter(valeur.trim()); }}>
        <h1>KayrosLab · Atelier</h1>
        <p>Ce poste est configuré en mode <strong>backend</strong> : les données et les clés restent côté serveur.</p>
        <label>
          <span>Jeton de session</span>
          <input
            type="password" value={valeur} autoComplete="off"
            onChange={(e) => setValeur(e.target.value)}
            placeholder="Collez votre jeton"
          />
        </label>
        <button type="submit" className="primaire large" disabled={!valeur.trim()}>Se connecter</button>
        {message && <p className="erreur">{message}</p>}
        <p className="note">
          Le jeton reste dans la session du navigateur. Il n’est ni enregistré durablement, ni transmis ailleurs qu’au backend.
        </p>
      </form>
    </div>
  );
}
