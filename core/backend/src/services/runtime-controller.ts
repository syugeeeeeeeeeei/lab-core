import Docker from "dockerode";
import { env } from "../lib/env.js";
import { db } from "../lib/db.js";

type RestartResult = {
  restartedContainers: string[];
  failedContainers: string[];
};

export class RuntimeController {
  private readonly docker = new Docker({ socketPath: env.dockerSocket });

  async restartApplication(applicationId: string): Promise<RestartResult> {
    const containers = db
      .prepare(
        `
          SELECT runtime_name
          FROM container_instances
          WHERE application_id = ?
        `
      )
      .all(applicationId) as Array<{ runtime_name: string }>;

    const restartedContainers: string[] = [];
    const failedContainers: string[] = [];

    for (const container of containers) {
      try {
        await this.docker.getContainer(container.runtime_name).restart();
        restartedContainers.push(container.runtime_name);
      } catch {
        failedContainers.push(container.runtime_name);
      }
    }

    return { restartedContainers, failedContainers };
  }
}

export const runtimeController = new RuntimeController();
