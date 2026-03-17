import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  checkUpdate,
  createApplication,
  deleteApplication,
  fetchApplications,
  fetchEvents,
  fetchRegistrationFixtures,
  fetchSystemStatus,
  rebuildApplication,
  restartApplication,
  syncInfrastructure
} from "./api";
import { registrationFixtures as fallbackRegistrationFixtures } from "./registrationFixtures";
import type {
  ApplicationListItem,
  CreateApplicationPayload,
  DeleteMode,
  RegistrationFixture,
  SystemEvent,
  SystemStatus
} from "./types";

const initialForm: CreateApplicationPayload = {
  name: "",
  description: "",
  repositoryUrl: "",
  defaultBranch: "main",
  composePath: "docker-compose.yml",
  publicServiceName: "web",
  publicPort: 3000,
  hostname: "",
  mode: "standard",
  keepVolumesOnRebuild: true,
  deviceRequirements: []
};

function toLocale(value: string): string {
  try {
    return new Date(value).toLocaleString("ja-JP");
  } catch {
    return value;
  }
}

function statusBadgeClass(status: string): string {
  if (status === "Running") {
    return "badge badge-ok";
  }
  if (status === "Degraded") {
    return "badge badge-warn";
  }
  if (status === "Failed") {
    return "badge badge-error";
  }
  return "badge";
}

function createFixtureSuffix(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}${hh}${mm}${ss}${ms}`;
}

function appendSuffixToHostname(hostname: string, suffix: string): string {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) {
    return `${hostname}-${suffix}`;
  }
  const [head, ...rest] = labels;
  return [`${head}-${suffix}`, ...rest].join(".");
}

function buildFixturePayload(fixture: RegistrationFixture): CreateApplicationPayload {
  const suffix = createFixtureSuffix();
  const payload = fixture.payload;
  const name = `${payload.name}-${suffix}`;

  return {
    ...payload,
    name: name.length > 80 ? name.slice(0, 80) : name,
    hostname: appendSuffixToHostname(payload.hostname, suffix)
  };
}

export function App() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [form, setForm] = useState<CreateApplicationPayload>(initialForm);
  const [fixtures, setFixtures] = useState<RegistrationFixture[]>(fallbackRegistrationFixtures);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(fallbackRegistrationFixtures[0]?.id ?? "");
  const [deviceRequirementsRaw, setDeviceRequirementsRaw] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ApplicationListItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("config_only");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12),
    [events]
  );

  async function reload(): Promise<void> {
    setLoading(true);
    setErrorMessage("");
    try {
      const [systemResponse, applicationsResponse, eventsResponse] = await Promise.all([
        fetchSystemStatus(),
        fetchApplications(),
        fetchEvents(120)
      ]);
      setSystem(systemResponse);
      setApplications(applicationsResponse);
      setEvents(eventsResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    void (async () => {
      try {
        const remoteFixtures = await fetchRegistrationFixtures();
        if (remoteFixtures.length > 0) {
          setFixtures(remoteFixtures);
        }
      } catch {
        // バックエンドのテストAPIが未使用でもローカルfixtureで継続できるようにする
      }
    })();
  }, []);

  useEffect(() => {
    if (fixtures.length === 0) {
      setSelectedFixtureId("");
      return;
    }
    if (!fixtures.some((fixture) => fixture.id === selectedFixtureId)) {
      setSelectedFixtureId(fixtures[0].id);
    }
  }, [fixtures, selectedFixtureId]);

  async function runAction(task: () => Promise<void>, successMessage: string): Promise<void> {
    setActionMessage("");
    setErrorMessage("");
    try {
      await task();
      setActionMessage(successMessage);
      await reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "処理に失敗しました。");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: CreateApplicationPayload = {
      ...form,
      deviceRequirements: deviceRequirementsRaw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    };

    await runAction(async () => createApplication(payload), "アプリを登録しました。");
    setForm(initialForm);
    setDeviceRequirementsRaw("");
  }

  function applyFixture(): void {
    const fixture = fixtures.find((item) => item.id === selectedFixtureId);
    if (!fixture) {
      return;
    }

    const payload = buildFixturePayload(fixture);
    setForm(payload);
    setDeviceRequirementsRaw(payload.deviceRequirements.join(", "));
    setActionMessage(`テスト値「${fixture.label}」を入力しました（重複回避サフィックス付き）。`);
  }

  async function onDeleteSubmit(): Promise<void> {
    if (!deleteTarget) {
      return;
    }

    if (deleteConfirmText.trim() !== deleteTarget.name) {
      setErrorMessage("確認用のアプリ名が一致しません。");
      return;
    }

    await runAction(
      async () => deleteApplication(deleteTarget.application_id, deleteMode),
      `${deleteTarget.name} の削除ジョブを開始しました。`
    );
    setDeleteTarget(null);
    setDeleteConfirmText("");
    setDeleteMode("config_only");
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="hero-label">LAB-CORE v3</p>
          <h1>研究室配信基盤ダッシュボード</h1>
          <p className="hero-subtitle">怖くない運用導線で、追加・再起動・復旧を一本化します。</p>
          {system?.execution ? (
            <p className="hero-mode">実行モード: {system.execution.mode === "dry-run" ? "dry-run" : "execute"}</p>
          ) : null}
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              void runAction(async () => syncInfrastructure("dashboard-manual-sync"), "DNS/Proxy 設定を同期しました。")
            }
            disabled={loading}
          >
            DNS/Proxy 同期
          </button>
          <button type="button" className="button secondary" onClick={() => void reload()} disabled={loading}>
            {loading ? "更新中..." : "最新状態に更新"}
          </button>
        </div>
      </header>

      {system ? (
        <section className="grid metrics">
          <article className="card metric">
            <p>登録アプリ</p>
            <strong>{system.applicationSummary.total}</strong>
          </article>
          <article className="card metric">
            <p>稼働中</p>
            <strong>{system.applicationSummary.running}</strong>
          </article>
          <article className="card metric warn">
            <p>不安定</p>
            <strong>{system.applicationSummary.degraded}</strong>
          </article>
          <article className="card metric error">
            <p>失敗</p>
            <strong>{system.applicationSummary.failed}</strong>
          </article>
        </section>
      ) : null}

      {actionMessage ? <p className="notice success">{actionMessage}</p> : null}
      {errorMessage ? <p className="notice error">{errorMessage}</p> : null}

      <main className="grid two-column">
        <section className="card form-card">
          <h2>アプリ登録</h2>
          <div className="fixture-tools">
            <label>
              登録テスト値
              <select value={selectedFixtureId} onChange={(event) => setSelectedFixtureId(event.target.value)}>
                {fixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button tiny secondary" onClick={applyFixture}>
              テスト値を入力
            </button>
          </div>
          <p className="fixture-hint">同名衝突を防ぐため、アプリ名とサブドメインに時刻サフィックスを自動付与します。</p>
          <form onSubmit={(event) => void onSubmit(event)} className="app-form">
            <label>
              アプリ名
              <input
                required
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label>
              Git URL
              <input
                required
                value={form.repositoryUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, repositoryUrl: event.target.value }))}
              />
            </label>
            <label>
              サブドメイン
              <input
                required
                placeholder="oruca.fukaya-sus.lab"
                value={form.hostname}
                onChange={(event) => setForm((prev) => ({ ...prev, hostname: event.target.value }))}
              />
            </label>
            <label>
              公開サービス名
              <input
                required
                value={form.publicServiceName}
                onChange={(event) => setForm((prev) => ({ ...prev, publicServiceName: event.target.value }))}
              />
            </label>
            <label>
              公開ポート
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={form.publicPort}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    publicPort: Number(event.target.value)
                  }))
                }
              />
            </label>
            <label>
              モード
              <select
                value={form.mode}
                onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value as "standard" | "headless" }))}
              >
                <option value="standard">Standard</option>
                <option value="headless">Headless</option>
              </select>
            </label>
            <label>
              デバイス要件 (カンマ区切り)
              <input
                placeholder="/dev/bus/usb, /dev/ttyUSB0"
                value={deviceRequirementsRaw}
                onChange={(event) => setDeviceRequirementsRaw(event.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={loading}>
              登録して配備キューに追加
            </button>
          </form>
        </section>

        <section className="card list-card">
          <h2>アプリ一覧</h2>
          <div className="list-scroll">
            <table>
              <thead>
                <tr>
                  <th>アプリ</th>
                  <th>状態</th>
                  <th>公開先</th>
                  <th>更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.application_id}>
                    <td>
                      <strong>{application.name}</strong>
                      <p>{application.mode === "headless" ? "Headless" : "Standard"}</p>
                    </td>
                    <td>
                      <span className={statusBadgeClass(application.status)}>{application.status}</span>
                    </td>
                    <td>
                      <a href={`http://${application.hostname}`} target="_blank" rel="noreferrer">
                        {application.hostname}
                      </a>
                    </td>
                    <td>{application.has_update ? "更新あり" : "最新"}</td>
                    <td>
                      <div className="action-row">
                        <button
                          type="button"
                          className="button tiny"
                          onClick={() =>
                            void runAction(
                              async () => restartApplication(application.application_id),
                              `${application.name} を再起動しました。`
                            )
                          }
                        >
                          再起動
                        </button>
                        <button
                          type="button"
                          className="button tiny secondary"
                          onClick={() =>
                            void runAction(
                              async () => rebuildApplication(application.application_id, true),
                              `${application.name} をデータ保持で再ビルドしました。`
                            )
                          }
                        >
                          再ビルド
                        </button>
                        <button
                          type="button"
                          className="button tiny warn"
                          onClick={() =>
                            void runAction(
                              async () => checkUpdate(application.application_id),
                              `${application.name} の更新確認を完了しました。`
                            )
                          }
                        >
                          更新確認
                        </button>
                        <button
                          type="button"
                          className="button tiny danger"
                          onClick={() => {
                            setDeleteTarget(application);
                            setDeleteMode("config_only");
                            setDeleteConfirmText("");
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={5}>登録されたアプリはありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card events-card full">
          <h2>最近のイベント</h2>
          <ul>
            {sortedEvents.map((event) => (
              <li key={event.event_id} className={`event-item ${event.level}`}>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.message}</p>
                </div>
                <time>{toLocale(event.created_at)}</time>
              </li>
            ))}
            {sortedEvents.length === 0 ? <li className="event-item">イベントはまだありません。</li> : null}
          </ul>
        </section>

        {deleteTarget ? (
          <section className="card delete-card full">
            <h2>削除確認: {deleteTarget.name}</h2>
            <p>破壊的操作です。削除モードを選び、確認のためアプリ名を入力してください。</p>
            <div className="delete-grid">
              <label>
                削除モード
                <select value={deleteMode} onChange={(event) => setDeleteMode(event.target.value as DeleteMode)}>
                  <option value="config_only">構成のみ削除</option>
                  <option value="source_and_config">構成 + ソース削除</option>
                  <option value="full">構成 + ソース + データ削除</option>
                </select>
              </label>
              <label>
                確認用アプリ名
                <input
                  placeholder={deleteTarget.name}
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                />
              </label>
            </div>
            <div className="delete-actions">
              <button type="button" className="button secondary" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </button>
              <button type="button" className="button danger" onClick={() => void onDeleteSubmit()} disabled={loading}>
                削除ジョブを開始
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
