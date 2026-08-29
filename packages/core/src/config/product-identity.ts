/**
 * Canonical Castor product/config/runtime identity constants (spec §14.1).
 *
 * These names are the single source of truth for what Castor writes and
 * reads. Legacy InkOS names appear only in the explicit compatibility
 * adapters (config/runtime/env) — never in core business logic.
 */

export const CASTOR_PRODUCT_NAME = "Castor Story Engine";
export const CASTOR_PRODUCT_SHORT_NAME = "Castor";
export const CASTOR_STUDIO_NAME = "Castor Studio";
export const CASTOR_DOCTOR_NAME = "Castor Doctor";
export const CASTOR_CLI_COMMAND = "castor";

/** Canonical project configuration file. */
export const CASTOR_CONFIG_FILENAME = "castor.json";

/** Legacy InkOS project configuration file (read-only compatibility input). */
export const LEGACY_INKOS_CONFIG_FILENAME = "inkos.json";

/** Canonical project/user runtime directory. */
export const CASTOR_RUNTIME_DIRNAME = ".castor";

/** Legacy InkOS runtime directory (read-only compatibility input). */
export const LEGACY_INKOS_RUNTIME_DIRNAME = ".inkos";
