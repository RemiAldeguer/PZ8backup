import type { PlanzoneWorkspace } from "../application/contracts";
export interface ResourceDialogProps {
  workspace: PlanzoneWorkspace;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}
