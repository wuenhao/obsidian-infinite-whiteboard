export const RUNTIME_VERSION = "0.4.84";
export const BUILD_FINGERPRINT = "0.4.84-community-release-r2";

export function runtimeMatchesManifest(manifestVersion: string): boolean {
  return manifestVersion === RUNTIME_VERSION;
}
