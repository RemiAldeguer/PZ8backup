import { AccessError } from "../application/errors";
export function accessErrorMessage(error: unknown): string {
  if (!(error instanceof AccessError))
    return "Le service est indisponible. Vérifiez votre connexion puis réessayez.";
  const messages: Record<string, string> = {
    ACCESS_DENIED: "Vous n’avez pas les droits nécessaires pour cette action.",
    NOT_FOUND: "Cet élément n’est plus disponible.",
    INVALID_SCOPE:
      "Le serveur a renvoyé une ressource ne correspondant pas à la requête.",
    INVALID_SESSION: "La session renvoyée est invalide.",
    INVALID_INPUT: "Vérifiez les champs de votre demande avant de l’envoyer.",
    UNKNOWN_RESTRICTIONS:
      "Les restrictions actuelles sont inconnues. Rechargez le profil avant de les modifier.",
    VERSION_CONFLICT:
      "Cette ressource a changé depuis son ouverture. Rechargez son profil avant de modifier à nouveau.",
    OPERATION_CONFLICT:
      "Cette opération est en conflit avec une demande précédente. Rien n’a été renvoyé automatiquement.",
    INVITATION_UNAVAILABLE: "Cette invitation a expiré ou a été révoquée.",
    INVITATION_ACCOUNT_MISMATCH:
      "Connectez-vous avec le compte dont l’adresse e-mail vérifiée correspond à cette invitation.",
    SESSION_REQUIRED: "Votre session a expiré. Connectez-vous à nouveau.",
    SESSION_EXPIRED: "Votre session a expiré. Connectez-vous à nouveau.",
  };
  return (
    (Object.hasOwn(messages, error.code) ? messages[error.code] : undefined) ??
    (error.kind === "unauthenticated"
      ? messages.SESSION_REQUIRED
      : error.kind === "forbidden"
        ? messages.ACCESS_DENIED
        : error.kind === "unavailable"
          ? "Le service est indisponible. Réessayez dans quelques instants."
          : error.message || "La demande n’a pas pu être traitée.")
  );
}
