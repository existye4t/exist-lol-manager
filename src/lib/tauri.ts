import { invoke as __TAURI_INVOKE } from "@tauri-apps/api/core";
import type {
  AssetRef,
  BinDocumentId,
  CreateProjectArgs,
  ExtractOptions,
  ExtractTarget,
  ImportFantomeArgs,
  ImportGitRepoArgs,
  LaunchTarget,
  InstallOutcome_Serialize as InstallOutcome,
  MaterialSource,
  ParticleDefine,
  ParticleShader,
  ProgramOptions,
  SandboxRef,
  ProjectMetadata,
  SearchPreference,
  UiShader,
  WadSource,
  WorkshopFileKind,
} from "@/lib/bindings";
import { commands as appUpdate } from "@/lib/ipc/appUpdate";
import { commands as atlas } from "@/lib/ipc/atlas";
import { commands as bin } from "@/lib/ipc/bin";
import { commands as desktop } from "@/lib/ipc/desktop";
import { commands as diagnostics } from "@/lib/ipc/diagnostics";
import { commands as game } from "@/lib/ipc/game";
import { commands as hotkeys } from "@/lib/ipc/hotkeys";
import { commands as integrations } from "@/lib/ipc/integrations";
import { commands as launcher } from "@/lib/ipc/launcher";
import { commands as library } from "@/lib/ipc/library";
import { commands as links } from "@/lib/ipc/links";
import { commands as news } from "@/lib/ipc/news";
import { commands as objects } from "@/lib/ipc/objects";
import { commands as patcher } from "@/lib/ipc/patcher";
import { commands as preview } from "@/lib/ipc/preview";
import { commands as settings } from "@/lib/ipc/settings";
import { commands as workshop } from "@/lib/ipc/workshop";
import { map as mapResult, type Result } from "@/utils/result";

export type * from "@/lib/bindings";
/* A serde `default` or `skip_serializing_if` splits a type by phase, and a command answers
the serialize side, so that side takes the plain name. An explicit export shadows the star. */
export type {
  AppErrorResponse as AppError,
  BulkInstallResult_Serialize as BulkInstallResult,
  Check_Serialize as Check,
  Config_Serialize as Config,
  DiagnosticReport_Serialize as DiagnosticReport,
  FixPreview_Serialize as FixPreview,
  HashtableUpdateCheck_Serialize as HashtableUpdateCheck,
  HealthCheckBasis_Serialize as HealthCheckBasis,
  HealthSweepReport_Serialize as HealthSweepReport,
  HealthSweepState_Serialize as HealthSweepState,
  Incident_Serialize as Incident,
  InstalledMod_Serialize as InstalledMod,
  InstallOutcome_Serialize as InstallOutcome,
  ModHealthVerdict_Serialize as ModHealthVerdict,
  ModLicense_Serialize as ModLicense,
  NodeAddress_Serialize as NodeAddress,
  ObjectInfo_Serialize as ObjectInfo,
  PatcherBinaries_Serialize as PatcherBinaries,
  Problem_Serialize as Problem,
  RuleBrief_Serialize as RuleBrief,
  RuleFailure_Serialize as RuleFailure,
  RuleInfo_Serialize as RuleInfo,
  Run_Serialize as Run,
  Settings_Serialize as Settings,
  Site_Serialize as Site,
  StoredVerdict_Serialize as StoredVerdict,
  Verdict_Serialize as Verdict,
} from "@/lib/bindings";
export type { Result } from "@/utils/result";

/** A project's metadata and the project it is written to. */
export type SaveProjectConfigArgs = ProjectMetadata & { projectPath: string };
export { isErr, isOk, match, unwrap, unwrapOr } from "@/utils/result";

export type ExistSkin = {
  id: string;
  skinNum: number;
  name: string;
  champion: string;
  nameEn: string;
  championEn: string;
  championId: string;
  image: string;
  imageFallback: string;
  parentSkinId: string | null;
  hasFantome: boolean;
};

export type ExistCatalog = {
  version: string;
  updatedAt: string;
  skins: ExistSkin[];
  fromCache: boolean;
};

export type ExistDownloadTask = {
  skinId: string;
  state: string;
  downloadedBytes: number | bigint;
  totalBytes: number | bigint | null;
  bytesPerSecond: number | bigint;
  etaSeconds: number | bigint | null;
  error: string | null;
};

export type ExistInstall = {
  skinId: string;
  modId: string;
  cachedPath: string;
};

export type InstalledExistSkin = {
  skinId: string;
  modId: string;
  cachedPath: string;
  fileSize: number | bigint;
  downloadedAt: string;
  applied: boolean;
};

export type ExistSkinUpdateInfo = {
  skinId: string;
  localHash: string;
  remoteHash: string | null;
  remoteSize: number | bigint | null;
  updateAvailable: boolean;
  localSize: number | bigint;
  lastChecked: string | null;
};

export type ExistSkinCatalogStatus = {
  version: string;
  updatedAt: string;
  fromCache: boolean;
};

export type ExistSyncStatus = {
  currentLtkVersion: string;
  latestLtkVersion: string | null;
  latestReleaseDate: string | null;
  hasNewLtkRelease: boolean;
  isCompatible: boolean;
  hasConflictingFiles: boolean;
  conflictingFiles: string[];
  safeToAutoUpdate: boolean;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  checkCount: number;
  lastError: string | null;
};

export type ExistAppUpdateInfo = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  releaseDate: string;
};

export type RuneforgeChampion = {
  id: number;
  name: string;
};

export type RuneforgeChampions = {
  champions: RuneforgeChampion[];
};

export type RuneforgePublisher = {
  id: string;
  username: string;
};

export type RuneforgeMod = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  publisher: RuneforgePublisher | null;
  description: string;
  thumbnailKey: string | null;
  category: string | null;
  viewCount: number | bigint;
  downloadCount: number | bigint;
  likeCount: number | bigint;
  champions: RuneforgeChampion[];
  themes: string[];
  features: string[];
  status: string | null;
  isGilded: boolean;
  publishedAt: string | null;
  isTrending: boolean;
};

export type RuneforgeCatalog = {
  mods: RuneforgeMod[];
  total: number;
};

export type RuneforgeCatalogQuery = {
  page: number;
  pageSize: number;
  search: string | null;
  championId: number | null;
  category: string | null;
  theme: string | null;
  feature: string | null;
};

async function invokeResult<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<Result<T, { message: string }>> {
  try {
    const res = await __TAURI_INVOKE<any>(cmd, args);
    if (res && typeof res === "object" && "ok" in res) {
      if (res.ok) {
        return { ok: true, value: res.value as T };
      }
      const message =
        typeof res.error === "string"
          ? res.error
          : res.error?.detail ?? res.error?.message ?? res.error?.code ?? JSON.stringify(res.error);
      return { ok: false, error: { message } };
    }
    return { ok: true, value: res as T };
  } catch (error: any) {
    const message = typeof error === "string" ? error : error?.message ?? String(error);
    return { ok: false, error: { message } };
  }
}

export interface RuneforgeInstalledRecord {
  modId: string;
  installedId: string;
  name: string;
  thumbnailKey?: string | null;
  downloadedAt: string;
}

// API functions
export const api = {
  integrations: {
    status: integrations.integrationStatus,
    release: integrations.integrationRelease,
    change: integrations.changeIntegration,
    cancel: integrations.cancelIntegrationDownload,
    fileTypeStatus: integrations.fileTypeStatus,
    openDefaultApps: integrations.openDefaultApps,
  },
  getAppInfo: desktop.getAppInfo,
  getPlatformSupport: desktop.getPlatformSupport,
  showMainWindow: desktop.showMainWindow,
  listReleases: news.listReleases,
  listAnnouncements: news.listAnnouncements,
  listNotices: news.listNotices,

  // Exist Skin Library
  getExistCatalog: () => invokeResult<ExistCatalog>("get_exist_catalog"),
  enqueueExistDownload: (skinId: string) =>
    invokeResult<void>("enqueue_exist_download", { skinId }),
  getExistDownloadQueue: () => invokeResult<ExistDownloadTask[]>("get_exist_download_queue"),
  pauseExistDownload: (skinId: string) => invokeResult<void>("pause_exist_download", { skinId }),
  resumeExistDownload: (skinId: string) => invokeResult<void>("resume_exist_download", { skinId }),
  cancelExistDownload: (skinId: string) => invokeResult<void>("cancel_exist_download", { skinId }),
  retryExistDownload: (skinId: string) => invokeResult<void>("retry_exist_download", { skinId }),
  removeExistDownload: (skinId: string) => invokeResult<void>("remove_exist_download", { skinId }),
  getInstalledExistSkins: () => invokeResult<InstalledExistSkin[]>("get_installed_exist_skins"),
  applyExistSkin: (skinId: string) => invokeResult<void>("apply_exist_skin", { skinId }),
  unapplyExistSkin: (skinId: string) => invokeResult<void>("unapply_exist_skin", { skinId }),
  deleteExistSkin: (skinId: string) => invokeResult<void>("delete_exist_skin", { skinId }),
  updateExistSkin: (skinId: string) =>
    invokeResult<ExistInstall>("update_exist_skin", { skinId }),
  checkExistSkinUpdate: (skinId: string) =>
    invokeResult<ExistSkinUpdateInfo | null>("check_exist_skin_update", { skinId }),
  getExistSkinsUpdateStatus: () =>
    invokeResult<ExistSkinUpdateInfo[]>("get_exist_skins_update_status"),
  syncExistSkinCatalog: () => invokeResult<ExistSkinCatalogStatus>("sync_exist_skin_catalog"),
  getExistCatalogStatus: () => invokeResult<ExistSkinCatalogStatus>("get_exist_catalog_status"),

  // RuneForge
  getRuneforgeCatalog: (query: RuneforgeCatalogQuery) =>
    invokeResult<RuneforgeCatalog>("get_runeforge_catalog", { query }),
  getRuneforgeChampions: () => invokeResult<RuneforgeChampions>("get_runeforge_champions"),
  getRuneforgeThumbnail: (thumbnailKey: string) =>
    invokeResult<string | null>("get_runeforge_thumbnail", { thumbnailKey }),
  getRuneforgeDownloadUrl: (modId: string) =>
    invokeResult<string>("get_runeforge_download_url", { modId }),
  installRuneforgeMod: (modId: string, thumbnailKey?: string | null) =>
    invokeResult<InstallOutcome>("install_runeforge_mod", { modId, thumbnailKey }),
  getInstalledRuneforgeIds: () =>
    invokeResult<string[]>("get_installed_runeforge_ids"),
  getRuneforgeInstalledRecords: () =>
    invokeResult<RuneforgeInstalledRecord[]>("get_runeforge_installed_records"),

  // Exist Sync & Update
  getExistSyncStatus: () => invokeResult<ExistSyncStatus>("get_exist_sync_status"),
  triggerUpstreamLtkCheck: () => invokeResult<ExistSyncStatus>("trigger_upstream_ltk_check"),
  checkExistAppUpdate: () => invokeResult<ExistAppUpdateInfo>("check_exist_app_update"),
  downloadAndInstallExistAppUpdate: (downloadUrl: string) =>
    invokeResult<void>("download_and_install_exist_app_update", { downloadUrl }),

  // Settings
  getSettings: settings.getSettings,
  getDefaultSettings: settings.getDefaultSettings,
  saveSettings: settings.saveSettings,
  autoDetectLeaguePath: settings.autoDetectLeaguePath,
  validateLeaguePath: settings.validateLeaguePath,
  checkSetupRequired: settings.checkSetupRequired,
  detectLeagueRunAsAdmin: settings.detectLeagueRunAsAdmin,
  listAvailableWads: settings.listAvailableWads,
  listForcibleMapSkins: settings.listForcibleMapSkins,
  listMapDecorations: settings.listMapDecorations,

  // Mods
  getInstalledMods: library.getInstalledMods,
  installMod: library.installMod,
  installMods: library.installMods,
  updateMod: library.updateMod,
  uninstallMod: library.uninstallMod,
  exportMods: library.exportMods,
  toggleMod: library.toggleMod,
  getModThumbnail: library.getModThumbnail,
  getModThumbnails: (modIds: readonly string[]) => library.getModThumbnails([...modIds]),
  getModReadme: library.getModReadme,
  getModLicenseText: library.getModLicenseText,
  getStorageDirectory: library.getStorageDirectory,
  reorderMods: library.reorderMods,
  setModLayers: (modId: string, layerStates: Record<string, boolean>) =>
    library.setModLayers(modId, layerStates),
  enableModWithLayers: (modId: string, layerStates: Record<string, boolean>) =>
    library.enableModWithLayers(modId, layerStates),
  editModMetadata: library.editModMetadata,
  setModStorage: library.setModStorage,
  getAllModWadReports: library.getAllModWadReports,
  analyzeModWads: library.analyzeModWads,
  checkModHealth: library.checkModHealth,
  /** Re-check `modIds`, or every mod in the library when none are named. */
  sweepModHealth: (modIds?: string[]) => library.sweepModHealth(modIds ?? null),
  repairMod: library.repairMod,
  repairMods: library.repairMods,
  getModHealthVerdicts: library.getModHealthVerdicts,
  getHealthSweep: library.getHealthSweep,
  getHealthCheckReadiness: library.getHealthCheckReadiness,
  cancelModHealthRun: library.cancelModHealthRun,
  /**
   * Time a health pass over the real library, into the dev console.
   *
   * Registered only in a debug build. `repair` runs the real repair, which
   * rewrites the mods it can fix and keeps no way back.
   */
  timeModHealth: library.timeModHealth,

  // Migration
  scanCslolMods: library.scanCslolMods,
  importCslolMods: library.importCslolMods,
  getLayoutMigrationState: library.getLayoutMigrationState,

  // Inspector

  // Patcher
  startPatcher: patcher.startPatcher,
  stopPatcher: patcher.stopPatcher,
  rebuildOverlay: patcher.rebuildOverlay,
  getPatcherStatus: patcher.getPatcherStatus,
  getLinkedBinOffenders: patcher.getLinkedBinOffenders,
  getChecksumMismatches: patcher.getChecksumMismatches,

  // Launcher
  // Resolves to null when a launch was already in flight - a redundant click.
  launchLeague: (target?: LaunchTarget) => launcher.launchLeague(target ?? null),
  // Resolves to false when nothing was in flight, which is what a Cancel
  // pressed just as the request landed looks like.
  cancelLaunch: launcher.cancelLaunch,
  stopLeague: launcher.stopLeague,
  getLaunchAvailability: launcher.getLaunchAvailability,
  // Also starts following the session it reports, so a game already in progress
  // when the app opened still reaches the session events.
  getLeagueSession: launcher.getLeagueSession,

  // Hotkeys
  pauseHotkeys: hotkeys.pauseHotkeys,
  resumeHotkeys: hotkeys.resumeHotkeys,
  setHotkey: hotkeys.setHotkey,

  // Profiles
  listModProfiles: library.listModProfiles,
  getActiveModProfile: library.getActiveModProfile,
  createModProfile: library.createModProfile,
  deleteModProfile: library.deleteModProfile,
  switchModProfile: library.switchModProfile,
  renameModProfile: library.renameModProfile,

  // Folders
  getFolders: library.getFolders,
  getFolderOrder: library.getFolderOrder,
  createFolder: library.createFolder,
  renameFolder: library.renameFolder,
  deleteFolder: library.deleteFolder,
  moveModToFolder: library.moveModToFolder,
  toggleFolder: library.toggleFolder,
  reorderFolderMods: library.reorderFolderMods,
  reorderFolders: library.reorderFolders,

  // Hashtables
  getHashtableCacheStatus: game.getHashtableCacheStatus,
  checkHashtableUpdates: game.checkHashtableUpdates,
  syncHashtables: game.syncHashtables,

  // Game and LCU WADs
  getGameWads: game.getGameWads,
  readGameWad: (source: WadSource, wadName: string) => game.readGameWad(wadName, source),

  // Game and LCU index
  getGameIndex: game.getGameIndex,
  readGameDir: (source: WadSource, path: string) => game.readGameDir(path, source),
  refreshGameIndex: game.refreshGameIndex,
  searchGameIndex: (query: string) => game.searchGameIndex(query, { kind: "palette" }),
  findInGameIndex: (source: WadSource, pattern: string, regex: boolean) =>
    game.findInGameIndex(pattern, regex, source),

  // Extract to disk
  planGameExtract: (
    source: WadSource,
    targets: ExtractTarget[],
    kinds: WorkshopFileKind[] | null,
  ) => game.planGameExtract(targets, kinds, source),
  // Resolves to null when an extract was already in flight - a redundant click.
  extractGameFiles: (source: WadSource, targets: ExtractTarget[], options: ExtractOptions) =>
    game.extractGameFiles(targets, options, source),
  // Resolves to false when nothing was in flight, which is what a Cancel
  // pressed just as the run finished looks like.
  cancelExtract: game.cancelExtract,

  // Asset preview
  readAssetInfo: preview.readAssetInfo,
  saveAssetCopy: preview.saveAssetCopy,

  // Ritobin
  detectRitobinIntegration: preview.detectRitobinIntegration,
  openAssetInRitobin: (asset: AssetRef, name?: string) =>
    preview.openAssetInRitobin(asset, name ?? null),

  // Deep Link
  deepLinkInstallMod: (
    url: string,
    name?: string | null,
    author?: string | null,
    source?: string | null,
  ) => links.deepLinkInstallMod(url, name ?? null, author ?? null, source ?? null),
  takePendingDeepLink: links.takePendingDeepLink,
  takePendingOpenedFiles: links.takePendingOpenedFiles,

  // Shell
  revealInExplorer: desktop.revealInExplorer,
  minimizeToTray: desktop.minimizeToTray,

  // Storage
  detectStorageMedium: desktop.detectStorageMedium,

  // The bin editor and the class reads over its documents.
  bin: {
    open: bin.binOpen,
    openVariant: bin.binOpenVariant,
    children: bin.binChildren,
    read: (document: BinDocumentId, entry: string, paths: readonly string[]) =>
      bin.binRead(document, entry, [...paths]),
    find: bin.binFind,
    edit: bin.binEdit,
    choices: bin.binChoices,
    copyValue: bin.binCopyValue,
    save: bin.binSave,
    reload: bin.binReload,
    undo: (document: BinDocumentId) => bin.binHistory(document, "undo"),
    redo: (document: BinDocumentId) => bin.binHistory(document, "redo"),
    changes: bin.binChanges,
    revert: bin.binRevert,
    declared: bin.binDeclared,
    overrides: bin.binOverrides,
    declareInto: bin.binDeclareInto,
    setDeclaring: bin.binSetDeclaring,
    rowDeclaration: bin.binRowDeclaration,
    roots: bin.binRoots,
    dependencies: bin.binDependencies,
    close: bin.binClose,
    classSchema: bin.classSchema,
    derivedClasses: bin.derivedClasses,
    classDocs: bin.classDocs,
    syncMetaDocs: bin.syncMetaDocs,
    readVfxSystem: preview.readVfxSystem,
    vfxTemplates: preview.vfxTemplates,
    readUiView: atlas.readUiView,
    readUiSceneView: atlas.readUiSceneView,
    readUiFont: atlas.readUiFont,
    readUiFontCatalog: atlas.readUiFontCatalog,
    readUiMaterialPrograms: (documents: readonly BinDocumentId[], entries: readonly string[]) =>
      atlas.readUiMaterialPrograms([...documents], [...entries]),
    readUiPrograms: (document: BinDocumentId | null, shaders: readonly UiShader[]) =>
      atlas.readUiPrograms(document, [...shaders]),
    readUiLoadout: atlas.readUiLoadout,
    readUiTooltips: atlas.readUiTooltips,
    readUiCharacters: atlas.readUiCharacters,
    atlasExportSprite: (
      texture: AssetRef,
      uv: readonly [number, number, number, number],
      destination: string,
    ) => atlas.atlasExportSprite(texture, [...uv], destination),
    atlasImportFontFile: atlas.atlasImportFontFile,
    atlasImportSprite: atlas.atlasImportSprite,
    atlasMakeSurface: atlas.atlasMakeSurface,
    atlasPatchSprite: (
      document: BinDocumentId,
      page: string,
      uv: readonly [number, number, number, number],
      source: string,
    ) => atlas.atlasPatchSprite(document, page, [...uv], source),
    atlasSheet: atlas.atlasSheet,
    readSkin: preview.readSkin,
    readMaterialPrograms: (
      source: MaterialSource,
      entries: readonly string[],
      options: ProgramOptions,
    ) =>
      preview.readMaterialPrograms(
        source,
        entries.map((entry) => ({ kind: "object" as const, entry })),
        options,
      ),
    readEmbeddedMaterialProgram: (
      source: MaterialSource,
      entry: string,
      path: string,
      options: ProgramOptions,
    ) =>
      preview
        .readMaterialPrograms(source, [{ kind: "embedded", entry, path }], options)
        .then((result) => mapResult(result, ([program]) => program ?? null)),
    readDefaultSkinnedProgram: (document: BinDocumentId, options: ProgramOptions) =>
      preview.readEngineProgram({ kind: "defaultSkinned", document }, options),
    readParticleProgram: (
      document: BinDocumentId | null,
      shader: ParticleShader,
      defines: readonly ParticleDefine[],
      options: ProgramOptions,
    ) =>
      preview.readEngineProgram(
        { kind: "particle", document, shader, defines: [...defines] },
        options,
      ),
    bakeSkinTangents: preview.bakeSkinTangents,
    saveSkinColliders: preview.saveSkinColliders,
    readMap: preview.readMap,
    readMapParticles: preview.readMapParticles,
    readMapCharacters: preview.readMapCharacters,
    readMapVariants: preview.readMapVariants,
    readMapOutline: preview.readMapOutline,
    locateFilesNear: (sandbox: SandboxRef, paths: readonly string[]) =>
      preview.locateFilesNear(sandbox, [...paths]),
    locateMapFiles: preview.locateMapFiles,
    readAnimationGraph: preview.readAnimationGraph,
    readClipHeader: preview.readClipHeader,
    readSpell: preview.readSpell,
  },

  // The object index and the install lookups a bin page makes.
  objects: {
    search: objects.searchObjectIndex,
    warm: objects.warmObjectIndex,
    drop: objects.dropObjectIndex,
    declared: (
      sandbox: SandboxRef,
      objectHashes: readonly string[],
      document: BinDocumentId | null = null,
    ) => objects.declaredObjects(sandbox, [...objectHashes], document),
    dir: objects.objectDir,
    spells: objects.characterSpells,
    classCount: objects.classObjectCount,
    find: objects.findObjects,
    references: objects.findReferences,
    cancelWalk: objects.cancelReferenceWalk,
    locateGameFiles: (paths: readonly string[]) => game.locateGameFiles([...paths]),
    searchGamePaths: (query: string, preference: SearchPreference) =>
      game.searchGameIndex(query, { kind: "pathField", preference }),
  },

  // Diagnostics. The generated `commands` object is flat, so the module boundary lives here.
  diagnostics: {
    run: diagnostics.runDiagnostics,
    openElevatedTerminal: diagnostics.openElevatedTerminal,
    listIncidents: diagnostics.listIncidents,
    dismissIncident: diagnostics.dismissIncident,
    dismissAllIncidents: diagnostics.dismissAllIncidents,
    revealGameLog: diagnostics.revealGameLog,
    incidentReport: diagnostics.incidentReport,
    incidentToken: diagnostics.incidentToken,
    decodeIncidentToken: diagnostics.decodeIncidentToken,
    telemetryIdentity: diagnostics.telemetryIdentity,
    resetTelemetrySecret: diagnostics.resetTelemetrySecret,
    trackUiError: diagnostics.trackUiError,
  },

  // Launcher.
  launcher: {
    checkInstallMismatch: launcher.checkInstallMismatch,
    switchLeagueInstall: launcher.switchLeagueInstall,
  },

  // The app's own update.
  updater: {
    check: appUpdate.checkUpdate,
    download: appUpdate.downloadUpdate,
    install: appUpdate.installUpdate,
    discard: appUpdate.discardUpdate,
  },

  // A project's ignore rules.
  ignoreRules: {
    read: workshop.getProjectIgnoreRules,
    recommended: workshop.recommendedIgnoreRules,
    save: workshop.saveProjectIgnoreRules,
    addRecommended: workshop.addRecommendedIgnoreRules,
  },

  // Folders opened as projects from anywhere on disk.
  projectFolders: {
    inspect: workshop.inspectProjectFolder,
    open: workshop.openProjectFolder,
    recordOpened: workshop.recordProjectOpened,
    list: workshop.getOpenedProjectFolders,
    forget: workshop.forgetProjectFolder,
    relocate: workshop.relocateProjectFolder,
    convert: workshop.convertFolderToProject,
    addAll: (paths: readonly string[]) => workshop.addProjectFolders([...paths]),
  },

  // Watches on an open project's layers, which announce `layer-files-changed`.
  layerWatch: {
    acquire: workshop.watchProjectLayers,
    release: workshop.unwatchProjectLayers,
  },

  // A project's root text files.
  projectText: {
    read: workshop.getProjectText,
    save: workshop.saveProjectText,
  },

  // A project's game data declarations.
  declarations: {
    outline: workshop.declarationsOutline,
    /** A module action with no document to undo it, for a view of the manifest itself. */
    moduleAction: bin.declarationsModuleAction,
  },

  // Workshop
  getWorkshopProjects: workshop.getWorkshopProjects,
  createWorkshopProject: (args: CreateProjectArgs) => workshop.createProject({ kind: "new", args }),
  getWorkshopProject: workshop.getWorkshopProject,
  getProjectContentTree: workshop.getProjectContentTree,
  saveProjectConfig: ({ projectPath, ...metadata }: SaveProjectConfigArgs) =>
    workshop.editProject(projectPath, { kind: "metadata", metadata }),
  renameWorkshopProject: workshop.renameWorkshopProject,
  deleteWorkshopProject: workshop.deleteWorkshopProject,
  packWorkshopProject: workshop.packWorkshopProject,
  importFromModpkg: (filePath: string) => workshop.createProject({ kind: "modpkg", filePath }),
  peekFantome: workshop.peekFantome,
  importFromFantome: (args: ImportFantomeArgs) => workshop.createProject({ kind: "fantome", args }),
  importFromGitRepo: (args: ImportGitRepoArgs) => workshop.createProject({ kind: "gitRepo", args }),
  validateProject: workshop.validateProject,
  analyzeProject: workshop.analyzeProject,
  fixProblems: workshop.fixProblems,
  setProjectThumbnail: (projectPath: string, imagePath: string) =>
    workshop.editProject(projectPath, { kind: "setThumbnail", imagePath }),
  removeProjectThumbnail: (projectPath: string) =>
    workshop.editProject(projectPath, { kind: "removeThumbnail" }),
  getProjectThumbnail: workshop.getProjectThumbnail,
  saveLayerStringOverrides: (
    projectPath: string,
    layerName: string,
    stringOverrides: Record<string, Record<string, string>>,
  ) =>
    workshop.editProject(projectPath, {
      kind: "stringOverrides",
      layer: layerName,
      overrides: stringOverrides,
    }),
  searchStringKeys: (query: string, limit?: number) => game.searchStringKeys(query, limit ?? null),
  lookupStringValues: game.lookupStringValues,
  readChampions: game.readChampions,
  getLayerContentPath: workshop.getLayerContentPath,
  getLayerInfo: workshop.getLayerInfo,
  createProjectLayer: (
    projectPath: string,
    name: string,
    displayName?: string,
    description?: string,
  ) =>
    workshop.editProject(projectPath, {
      kind: "createLayer",
      name,
      displayName: displayName ?? null,
      description: description ?? null,
    }),
  renameProjectLayer: (projectPath: string, layerName: string, newDisplayName: string) =>
    workshop.editProject(projectPath, {
      kind: "renameLayer",
      layer: layerName,
      displayName: newDisplayName,
    }),
  deleteProjectLayer: (projectPath: string, layerName: string) =>
    workshop.editProject(projectPath, { kind: "deleteLayer", layer: layerName }),
  reorderProjectLayers: (projectPath: string, layerNames: string[]) =>
    workshop.editProject(projectPath, { kind: "reorderLayers", layers: layerNames }),
  updateLayerDescription: (projectPath: string, layerName: string, description?: string) =>
    workshop.editProject(projectPath, {
      kind: "describeLayer",
      layer: layerName,
      description: description ?? null,
    }),
  addFilesToLayer: workshop.addFilesToLayer,
  deleteLayerContent: workshop.deleteLayerContent,
  // The editor state file is opaque to the backend, so both sides are strings.
  getProjectEditorState: workshop.getProjectEditorState,
  saveProjectEditorState: workshop.saveProjectEditorState,
};

/**
 * Open the file manager on `path`, for a control with nowhere to put a failure.
 *
 * A reveal the shell refuses is a dead click and nothing worse, so this logs and
 * returns rather than growing an error surface onto every caller. Both the
 * refusal and a rejected `invoke` land in the log.
 */
export function revealPath(path: string): void {
  void api.revealInExplorer(path).then(
    (result) => {
      if (!result.ok) console.error("Could not reveal", path, result.error);
    },
    (error: unknown) => console.error("Could not reveal", path, error),
  );
}
