import { KeyRound } from 'lucide-react';

/** Les comptes et mots de passe du serveur ne sont pas utilisés par l'espace local. */
export function MemberAccess() {
  return <section className="member-access"><h3><KeyRound size={16} /> Accès local</h3><p>Cette fiche ne crée aucun compte : tous les utilisateurs de ce navigateur ont accès à la base importée, sans mot de passe. Exportez un fichier .sqlite pour partager ou sauvegarder les données manuellement.</p></section>;
}
