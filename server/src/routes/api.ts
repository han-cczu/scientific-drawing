/** Compatibility exports for integrations migrating to the service modules. */
import { createServices } from "../services";
import { createApiRouter } from "./index";

export const apiRouter = createApiRouter(createServices());
export { createApiRouter } from "./index";
export { isAllowedMutationOrigin, LOOPBACK_HOSTS } from "./originGuard";
export { toReconstructEnvelope } from "./reconstructErrors";
export { isAllowedImageMime } from "../storage/imageTypes";
export { sanitizeFileBase, sanitizeUnicodeFileBase } from "../storage/fileNames";
export { ensureReplicaBaseLayer, repairAndValidateSceneForPersistence, validateSceneForExport } from "../services/sceneValidation";
export { exportKindConfig } from "../services/exportService";
