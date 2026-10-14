import { useMemo } from "react";
import type { PlanzoneSummary } from "./domain/models";
import { createBrowserAccessApplication } from "./composition";
import { AccessAppSession } from "./presentation/AccessAppSession";
import { Empty } from "./presentation/ui";
import "./presentation/access.css";

export interface Pz7AccessAppProps {
  /** Same-origin API root, e.g. "" or "/gateway"; /api/v1 is appended. */
  apiBaseUrl?: string;
  onPlanzoneChange?: (planzone: PlanzoneSummary | null) => void;
}
export function Pz7AccessApp({
  apiBaseUrl = "",
  onPlanzoneChange,
}: Pz7AccessAppProps) {
  const configured = useMemo(() => {
    try {
      return createBrowserAccessApplication(apiBaseUrl);
    } catch (error) {
      return { error };
    }
  }, [apiBaseUrl]);
  if (!("application" in configured))
    return (
      <div className="pz7-access" lang="fr">
        <Empty title="Configuration API invalide">
          La racine de l’API doit rester sur la même origine que cette
          interface.
        </Empty>
      </div>
    );
  return (
    <AccessAppSession
      key={configured.base}
      client={configured.application}
      onPlanzoneChange={onPlanzoneChange}
    />
  );
}
