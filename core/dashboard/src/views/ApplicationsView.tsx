import type { ApplicationListItem } from "../types";
import { jobStatusBadgeClass, shortCommit, statusBadgeClass, toLocale } from "../ui";

type ApplicationsViewProps = {
  applications: ApplicationListItem[];
  onOpenDetail: (applicationId: string) => void;
};

export function ApplicationsView(props: ApplicationsViewProps) {
  const { applications, onOpenDetail } = props;

  return (
    <div className="view-grid">
      <section className="panel-card grow">
        <div className="panel-head">
          <h2>アプリ一覧</h2>
          <p className="table-count">{applications.length} 件</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>アプリ</th>
                <th>状態</th>
                <th>公開先</th>
                <th>更新</th>
                <th>最終更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.application_id}>
                  <td>
                    <strong>{application.name}</strong>
                    <p>{application.mode === "headless" ? "Headless" : "Standard"}</p>
                    <p>current: {shortCommit(application.current_commit)}</p>
                  </td>
                  <td>
                    <div className="status-cell">
                      <span className={statusBadgeClass(application.status)}>{application.status}</span>
                      {application.latest_job_status && application.latest_job_message ? (
                        <div className="job-preview">
                          <span className={jobStatusBadgeClass(application.latest_job_status)}>
                            {application.latest_job_type ?? "job"} / {application.latest_job_status}
                          </span>
                          <p className="job-preview-message">{application.latest_job_message}</p>
                        </div>
                      ) : null}
                      {application.latest_error_title ? <p className="error-preview">{application.latest_error_title}</p> : null}
                      {application.latest_error_message ? <p className="error-detail">{application.latest_error_message}</p> : null}
                    </div>
                  </td>
                  <td>
                    <a href={`http://${application.hostname}`} target="_blank" rel="noreferrer">
                      {application.hostname}
                    </a>
                  </td>
                  <td>{application.has_update ? "更新あり" : "最新"}</td>
                  <td>{toLocale(application.updated_at)}</td>
                  <td>
                    <button type="button" className="button tiny primary" onClick={() => onOpenDetail(application.application_id)}>
                      詳細へ
                    </button>
                  </td>
                </tr>
              ))}
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={6}>登録されたアプリはありません。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
