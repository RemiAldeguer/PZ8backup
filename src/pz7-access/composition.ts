import { createAccessApplication } from "./application/create-access-application";
import {
  createBrowserNavigation,
  browserOperationIds,
} from "./infrastructure/browser-navigation";
import { AccessHttpTransport, apiPath } from "./infrastructure/http/transport";
import { HttpSessionGateway } from "./infrastructure/http/session-gateway";
import { HttpResourcesGateway } from "./infrastructure/http/resources-gateway";
import { HttpInvitationsGateway } from "./infrastructure/http/invitations-gateway";

/** The sole place wiring browser and HTTP adapters into application ports. */
export function createBrowserAccessApplication(apiBaseUrl = "") {
  const base = apiPath(apiBaseUrl, window.location.origin);
  const transport = new AccessHttpTransport(base);
  const session = new HttpSessionGateway(transport);
  return {
    base,
    application: createAccessApplication(
      {
        session,
        workspace: session,
        resources: new HttpResourcesGateway(transport),
        invitations: new HttpInvitationsGateway(transport),
      },
      createBrowserNavigation(base),
      browserOperationIds,
    ),
  };
}
