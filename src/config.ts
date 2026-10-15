import os from "node:os";
import path from "node:path";

/** Neutral placeholder brand. Replace before publishing. */
export const BRAND = process.env.TSMCP_BRAND ?? "PackWarden";
export const VERSION = "0.1.0";
export const BASE_URL = (process.env.TSMCP_BASE_URL ?? "https://thunderstore.io").replace(/\/$/, "");
export const CACHE_DIR = process.env.TSMCP_CACHE_DIR ?? path.join(os.homedir(), ".cache", "thunderstore-mcp");
/** How long a community's package list is considered fresh (ms). Default 1h. */
export const LIST_TTL_MS = Number(process.env.TSMCP_LIST_TTL_MS ?? 60 * 60 * 1000);
/** Minimum gap between any two outbound requests (ms). Default 1s. */
export const MIN_REQUEST_INTERVAL_MS = Number(process.env.TSMCP_MIN_INTERVAL_MS ?? 1000);
export const CONTACT = process.env.TSMCP_CONTACT ?? "support@packwarden.dev";
export const USER_AGENT = `${BRAND}-thunderstore-mcp/${VERSION} (+${CONTACT})`;
export const EXPORT_DIR = process.env.TSMCP_EXPORT_DIR ?? path.join(process.cwd(), "exports");
