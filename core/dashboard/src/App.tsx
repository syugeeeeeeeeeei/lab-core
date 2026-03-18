import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  applyUpdate,
  checkUpdate,
  createApplication,
  deleteApplication,
  fetchApplicationLogs,
  fetchApplicationLogServices,
  fetchApplications,
  fetchEvents,
  fetchSystemStatus,
  inspectComposeFile,
  rebuildApplication,
  resolveImportSource,
  restartApplication,
  rollbackApplication,
  syncInfrastructure
} from "./api";
import { DashboardShell, type DashboardView } from "./components/DashboardShell";
import type {
  ApplicationListItem,
  ComposeServiceCandidate,
  CreateApplicationPayload,
  DeleteMode,
  ImportResolveResponse,
  SystemEvent,
  SystemStatus
} from "./types";
import { ApplicationDetailView, type DetailLogState } from "./views/ApplicationDetailView";
import { ApplicationsView } from "./views/ApplicationsView";
import { HomeView } from "./views/HomeView";
import { ImportView, type ImportComposeState, type ImportFormState, type ImportResolveState } from "./views/ImportView";

const AUTO_REFRESH_MS = 15000;
const LOG_AUTO_REFRESH_MS = 5000;
const TOAST_DURATION_MS = 4800;

const initialImportForm: ImportFormState = {
  name: "",
  description: "",
  sourceUrl: "",
  defaultBranch: "main",
  composePath: "docker-compose.yml",
  publicServiceName: "web",
  publicPort: "3000",
  hostname: "",
  mode: "standard",
  keepVolumesOnRebuild: true
};

const initialResolveState: ImportResolveState = {
  status: "idle",
  canonicalRepositoryUrl: "",
  branchCandidates: [],
  branchFixed: false,
  repositoryFiles: [],
  yamlFiles: [],
  composeCandidates: [],
  recommendedComposePath: null,
  warning: ""
};

const initialComposeState: ImportComposeState = {
  status: "idle",
  services: [],
  warning: ""
};

const initialLogState: DetailLogState = {
  opened: false,
  services: [],
  selectedService: "",
  tail: 200,
  lines: [],
  lastFetchedAt: "",
  loading: false,
  autoScroll: true
};

function buildCreatePayload(form: ImportFormState, deviceRequirementsRaw: string): CreateApplicationPayload {
  return {
    name: form.name,
    description: form.description,
    repositoryUrl: form.sourceUrl.trim(),
    defaultBranch: form.defaultBranch.trim().length > 0 ? form.defaultBranch.trim() : "main",
    composePath: form.composePath.trim().length > 0 ? form.composePath.trim() : "docker-compose.yml",
    publicServiceName: form.publicServiceName,
    publicPort: Number(form.publicPort),
    hostname: form.hostname,
    mode: form.mode,
    keepVolumesOnRebuild: form.keepVolumesOnRebuild,
    deviceRequirements: deviceRequirementsRaw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  };
}

function chooseRecommendedService(services: ComposeServiceCandidate[]): ComposeServiceCandidate | null {
  return (
    services.find((service) => service.likelyPublic && service.detectedPublicPort !== null) ??
    services.find((service) => service.detectedPublicPort !== null) ??
    services[0] ??
    null
  );
}

export function App() {
  const [activeView, setActiveView] = useState<DashboardView>("home");
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);

  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);

  const [form, setForm] = useState<ImportFormState>(initialImportForm);
  const [resolveState, setResolveState] = useState<ImportResolveState>(initialResolveState);
  const [composeState, setComposeState] = useState<ImportComposeState>(initialComposeState);
  const [deviceRequirementsRaw, setDeviceRequirementsRaw] = useState("");

  const [logs, setLogs] = useState<DetailLogState>(initialLogState);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("config_only");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedApplication = useMemo(
    () => applications.find((application) => application.application_id === selectedApplicationId) ?? null,
    [applications, selectedApplicationId]
  );

  async function reload(options: { mode?: "manual" | "background" | "action" } = {}): Promise<void> {
    const mode = options.mode ?? "manual";

    if (mode === "background" && (refreshing || busy)) {
      return;
    }

    if (mode === "manual") {
      setBusy(true);
      setErrorMessage("");
    } else if (mode === "background") {
      setRefreshing(true);
    }

    try {
      const [systemResponse, applicationsResponse, eventsResponse] = await Promise.all([
        fetchSystemStatus(),
        fetchApplications(),
        fetchEvents(120)
      ]);
      setSystem(systemResponse);
      setApplications(applicationsResponse);
      setEvents(eventsResponse);
      setInitialLoaded(true);
    } catch (error) {
      if (mode !== "background") {
        setErrorMessage(error instanceof Error ? error.message : "読み込みに失敗しました。");
      }
    } finally {
      if (mode === "manual") {
        setBusy(false);
      } else if (mode === "background") {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!initialLoaded) {
      return;
    }

    const onDemandRefresh = () => {
      if (document.visibilityState === "visible") {
        void reload({ mode: "background" });
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void reload({ mode: "background" });
      }
    }, AUTO_REFRESH_MS);

    window.addEventListener("focus", onDemandRefresh);
    document.addEventListener("visibilitychange", onDemandRefresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onDemandRefresh);
      document.removeEventListener("visibilitychange", onDemandRefresh);
    };
  }, [initialLoaded, busy, refreshing]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => setActionMessage(""), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [actionMessage]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => setErrorMessage(""), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [errorMessage]);

  useEffect(() => {
    if (!selectedApplicationId) {
      return;
    }
    if (!applications.some((application) => application.application_id === selectedApplicationId)) {
      setSelectedApplicationId(null);
      setActiveView("apps");
      setLogs(initialLogState);
      setDeleteConfirmText("");
      setDeleteMode("config_only");
    }
  }, [applications, selectedApplicationId]);

  useEffect(() => {
    if (!selectedApplication || activeView !== "detail" || !logs.opened) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !logs.loading) {
        void refreshLogs(logs.selectedService || undefined, logs.tail);
      }
    }, LOG_AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [activeView, logs.loading, logs.opened, logs.selectedService, logs.tail, selectedApplication]);

  async function runAction(task: () => Promise<void>, successMessage: string): Promise<void> {
    setBusy(true);
    setActionMessage("");
    setErrorMessage("");

    try {
      await task();
      setActionMessage(successMessage);
      await reload({ mode: "action" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "処理に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  function openDetail(applicationId: string): void {
    setSelectedApplicationId(applicationId);
    setActiveView("detail");
    setLogs(initialLogState);
    setDeleteConfirmText("");
    setDeleteMode("config_only");
  }

  function onFormFieldChange<K extends keyof ImportFormState>(key: K, value: ImportFormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));

    if (key === "sourceUrl") {
      setResolveState(initialResolveState);
      setComposeState(initialComposeState);
      return;
    }

    if (key === "defaultBranch" || key === "composePath") {
      setComposeState(initialComposeState);
    }
  }

  function applyResolveResult(result: ImportResolveResponse): void {
    setResolveState({
      status: "resolved",
      canonicalRepositoryUrl: result.canonicalRepositoryUrl,
      branchCandidates: result.branchCandidates,
      branchFixed: result.branchFixed,
      repositoryFiles: result.repositoryFiles,
      yamlFiles: result.yamlFiles,
      composeCandidates: result.composeCandidates,
      recommendedComposePath: result.recommendedComposePath,
      warning: result.warning ?? ""
    });
    setForm((prev) => ({
      ...prev,
      defaultBranch: result.resolvedBranch,
      composePath: result.recommendedComposePath ?? prev.composePath
    }));
  }

  async function inspectCompose(
    composePath: string,
    options: {
      repositoryUrl?: string;
      branch?: string;
      autoSelect?: boolean;
    } = {}
  ): Promise<void> {
    const repositoryUrl = options.repositoryUrl ?? resolveState.canonicalRepositoryUrl;
    const branch = options.branch ?? form.defaultBranch;
    const normalizedPath = composePath.trim();

    if (repositoryUrl.length === 0 || branch.trim().length === 0 || normalizedPath.length === 0) {
      return;
    }

    setComposeState({ status: "inspecting", services: [], warning: "" });

    try {
      const inspection = await inspectComposeFile(repositoryUrl, branch, normalizedPath);
      setComposeState({
        status: "ready",
        services: inspection.services,
        warning: inspection.warning ?? ""
      });
      setForm((prev) => ({ ...prev, composePath: inspection.composePath }));

      if (options.autoSelect !== false) {
        const recommended = chooseRecommendedService(inspection.services);
        if (recommended) {
          setForm((prev) => ({
            ...prev,
            publicServiceName: recommended.name,
            publicPort: String(recommended.detectedPublicPort ?? prev.publicPort)
          }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "compose 解析に失敗しました。";
      setComposeState({
        status: "error",
        services: [],
        warning: message
      });
    }
  }

  async function resolveSource(): Promise<void> {
    const sourceUrl = form.sourceUrl.trim();
    if (sourceUrl.length === 0) {
      setResolveState(initialResolveState);
      setComposeState(initialComposeState);
      return;
    }

    setResolveState((prev) => ({ ...prev, status: "resolving", warning: "" }));
    setComposeState(initialComposeState);

    try {
      const result = await resolveImportSource(sourceUrl);
      applyResolveResult(result);

      if (result.recommendedComposePath) {
        await inspectCompose(result.recommendedComposePath, {
          repositoryUrl: result.canonicalRepositoryUrl,
          branch: result.resolvedBranch,
          autoSelect: true
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "URL解析に失敗しました。";
      setResolveState({
        ...initialResolveState,
        status: "error",
        warning: `${message} 手入力で続行できます。`
      });
      setComposeState(initialComposeState);
      setForm((prev) => ({
        ...prev,
        defaultBranch: prev.defaultBranch.trim().length > 0 ? prev.defaultBranch : "main"
      }));
    }
  }

  async function onImportSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const payload = buildCreatePayload(form, deviceRequirementsRaw);

    if (payload.repositoryUrl.length === 0) {
      setErrorMessage("GitHub URL を入力してください。");
      return;
    }

    setBusy(true);
    setActionMessage("");
    setErrorMessage("");

    try {
      const response = await createApplication(payload);
      setActionMessage("アプリを登録しました。");
      setForm(initialImportForm);
      setDeviceRequirementsRaw("");
      setResolveState(initialResolveState);
      setComposeState(initialComposeState);
      await reload({ mode: "action" });
      openDetail(response.applicationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "アプリ登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function openLogs(application: ApplicationListItem): Promise<void> {
    setLogs({
      opened: true,
      services: [],
      selectedService: "",
      tail: 200,
      lines: [],
      lastFetchedAt: "",
      loading: true,
      autoScroll: true
    });

    try {
      const services = await fetchApplicationLogServices(application.application_id);
      const defaultService = services.includes(application.public_service_name)
        ? application.public_service_name
        : (services[0] ?? "");

      const snapshot = await fetchApplicationLogs(application.application_id, {
        service: defaultService.length > 0 ? defaultService : undefined,
        tail: 200
      });

      setLogs((prev) => ({
        ...prev,
        opened: true,
        services,
        selectedService: defaultService,
        lines: snapshot.lines,
        tail: 200,
        lastFetchedAt: snapshot.fetchedAt,
        loading: false
      }));
    } catch (error) {
      setLogs((prev) => ({ ...prev, loading: false }));
      setErrorMessage(error instanceof Error ? error.message : "ログビューアの初期化に失敗しました。");
    }
  }

  async function refreshLogs(service?: string, tail?: number): Promise<void> {
    if (!selectedApplication) {
      return;
    }

    const nextService = service ?? logs.selectedService;
    const nextTail = tail ?? logs.tail;

    setLogs((prev) => ({ ...prev, loading: true }));
    try {
      const snapshot = await fetchApplicationLogs(selectedApplication.application_id, {
        service: nextService.length > 0 ? nextService : undefined,
        tail: nextTail
      });
      setLogs((prev) => ({
        ...prev,
        selectedService: nextService,
        tail: nextTail,
        lines: snapshot.lines,
        lastFetchedAt: snapshot.fetchedAt,
        loading: false
      }));
    } catch (error) {
      setLogs((prev) => ({ ...prev, loading: false }));
      setErrorMessage(error instanceof Error ? error.message : "ログ取得に失敗しました。");
    }
  }

  async function onDeleteSubmit(): Promise<void> {
    if (!selectedApplication) {
      return;
    }

    if (deleteConfirmText.trim() !== selectedApplication.name) {
      setErrorMessage("確認用のアプリ名が一致しません。");
      return;
    }

    await runAction(
      async () => deleteApplication(selectedApplication.application_id, deleteMode),
      `${selectedApplication.name} の削除ジョブを開始しました。`
    );

    setDeleteConfirmText("");
    setDeleteMode("config_only");
    setLogs(initialLogState);
    setSelectedApplicationId(null);
    setActiveView("apps");
  }

  return (
    <DashboardShell
      activeView={activeView}
      detailEnabled={selectedApplication !== null}
      executionMode={system?.execution?.mode ?? null}
      loading={busy}
      onNavigate={setActiveView}
      onReload={() => void reload()}
      onSyncInfrastructure={() =>
        void runAction(async () => syncInfrastructure("dashboard-manual-sync"), "DNS/Proxy 設定を同期しました。")
      }
    >
      {(actionMessage || errorMessage) ? (
        <div className="toast-stack" aria-live="polite">
          {actionMessage ? <p className="notice success toast-notice">{actionMessage}</p> : null}
          {errorMessage ? <p className="notice error toast-notice">{errorMessage}</p> : null}
        </div>
      ) : null}

      {activeView === "home" ? (
        <HomeView
          system={system}
          applications={applications}
          events={events}
          onOpenApplications={() => setActiveView("apps")}
          onOpenImport={() => setActiveView("import")}
          onOpenDetail={(applicationId) => openDetail(applicationId)}
        />
      ) : null}

      {activeView === "apps" ? (
        <ApplicationsView applications={applications} onOpenDetail={(applicationId) => openDetail(applicationId)} />
      ) : null}

      {activeView === "import" ? (
        <ImportView
          form={form}
          deviceRequirementsRaw={deviceRequirementsRaw}
          resolveState={resolveState}
          composeState={composeState}
          loading={busy}
          onFieldChange={onFormFieldChange}
          onDeviceRequirementsChange={setDeviceRequirementsRaw}
          onResolveSource={resolveSource}
          onInspectCompose={(composePath) => inspectCompose(composePath, { autoSelect: true })}
          onSelectService={(service) =>
            setForm((prev) => ({
              ...prev,
              publicServiceName: service.name,
              publicPort: String(service.detectedPublicPort ?? prev.publicPort)
            }))
          }
          onSubmit={onImportSubmit}
        />
      ) : null}

      {activeView === "detail" ? (
        <ApplicationDetailView
          application={selectedApplication}
          events={events}
          loading={busy}
          logs={logs}
          deleteMode={deleteMode}
          deleteConfirmText={deleteConfirmText}
          onBackToApplications={() => setActiveView("apps")}
          onRestart={(applicationId, applicationName) =>
            void runAction(async () => restartApplication(applicationId), `${applicationName} を再起動しました。`)
          }
          onRebuild={(applicationId, applicationName) =>
            void runAction(async () => rebuildApplication(applicationId, true), `${applicationName} をデータ保持で再ビルドしました。`)
          }
          onCheckUpdate={(applicationId, applicationName) =>
            void runAction(async () => checkUpdate(applicationId), `${applicationName} の更新確認を完了しました。`)
          }
          onApplyUpdate={(applicationId, applicationName) =>
            void runAction(async () => applyUpdate(applicationId), `${applicationName} の更新適用ジョブを開始しました。`)
          }
          onRollback={(applicationId, applicationName) =>
            void runAction(async () => rollbackApplication(applicationId), `${applicationName} のロールバックジョブを開始しました。`)
          }
          onOpenLogs={(application) => void openLogs(application)}
          onRefreshLogs={(service, tail) => void refreshLogs(service, tail)}
          onCloseLogs={() => setLogs(initialLogState)}
          onSetSelectedLogService={(service) => setLogs((prev) => ({ ...prev, selectedService: service }))}
          onSetLogTail={(tail) => setLogs((prev) => ({ ...prev, tail }))}
          onSetAutoScroll={(enabled) => setLogs((prev) => ({ ...prev, autoScroll: enabled }))}
          onDeleteModeChange={setDeleteMode}
          onDeleteConfirmChange={setDeleteConfirmText}
          onDeleteSubmit={() => void onDeleteSubmit()}
        />
      ) : null}
    </DashboardShell>
  );
}
