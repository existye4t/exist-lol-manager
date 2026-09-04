export const updaterKeys = {
  all: ["updater"] as const,
  releases: () => [...updaterKeys.all, "releases"] as const,
};
