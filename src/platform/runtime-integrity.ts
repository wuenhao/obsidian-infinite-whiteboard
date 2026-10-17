export const RUNTIME_VERSION = "0.4.82";
export const BUILD_FINGERPRINT = "0.4.82-community-release-r1";

export function runtimeMatchesManifest(manifestVersion: string): boolean {
  return manifestVersion === RUNTIME_VERSION;
}
