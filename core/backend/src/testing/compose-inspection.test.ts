import test from "node:test";
import assert from "node:assert/strict";
import { inspectComposeYaml } from "../services/compose-inspection.js";

function inspect(rawYaml: string) {
  return inspectComposeYaml({
    rawYaml,
    selectedComposePath: "docker-compose.yml",
    composeCandidates: ["docker-compose.yml"],
    yamlFiles: ["docker-compose.yml"],
    recommendedComposePath: "docker-compose.yml",
    source: {
      kind: "github",
      path: "docker-compose.yml",
      repositoryUrl: "https://github.com/example/repo.git",
      branch: "main",
      blobUrl: "https://api.github.com/repos/example/repo/git/blobs/example"
    }
  });
}

test("detects service and expose port from nested compose yaml", () => {
  const inspection = inspect(`
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
      target: prod
    restart: unless-stopped
    environment:
      PORT: "\${PORT:-8080}"
    expose:
      - "\${PORT:-8080}"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "wget -qO- http://127.0.0.1:\${PORT:-8080}/health >/dev/null || exit 1",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
`);

  const web = inspection.services.find((service) => service.name === "web");
  assert.ok(web);
  assert.equal(inspection.parseError, null);
  assert.equal(web.detectedPublicPort, 8080);
  assert.deepEqual(web.portOptions, [8080]);
  assert.deepEqual(web.exposePorts, [8080]);
});

test("parses short syntax ports with env placeholders and host ip", () => {
  const inspection = inspect(`
services:
  web:
    environment:
      PORT: "8080"
    ports:
      - "127.0.0.1:\${PORT:-8080}:8080"
      - "80/tcp"
`);

  const web = inspection.services.find((service) => service.name === "web");
  assert.ok(web);
  assert.deepEqual(web.portOptions, [80, 8080]);
  assert.deepEqual(web.publishedPorts, [8080]);
  assert.equal(web.detectedPublicPort, 80);
});

test("parses long syntax ports objects", () => {
  const inspection = inspect(`
services:
  api:
    ports:
      - target: 3000
        published: "\${PUBLIC_PORT:-18080}"
        protocol: tcp
        mode: ingress
`);

  const api = inspection.services.find((service) => service.name === "api");
  assert.ok(api);
  assert.deepEqual(api.portOptions, [3000]);
  assert.deepEqual(api.publishedPorts, [18080]);
  assert.equal(api.detectedPublicPort, 3000);
});

test("returns parse errors without crashing for malformed yaml", () => {
  const inspection = inspect(`
services:
  web:
    image: nginx
    ports:
      - "8080:80"
  broken:
    [
`);

  assert.ok(inspection.parseError);
  assert.equal(inspection.parsedYaml, null);
  assert.deepEqual(inspection.services, []);
  assert.equal(inspection.rawYaml.includes("broken"), true);
});

test("warns when services root is missing", () => {
  const inspection = inspect(`
name: demo
volumes:
  data: {}
`);

  assert.equal(inspection.parseError, null);
  assert.deepEqual(inspection.services, []);
  assert.ok(inspection.analysisWarnings.includes("services ルートが見つかりません。"));
});

test("collects device requirements across non-public services", () => {
  const inspection = inspect(`
services:
  web:
    expose:
      - "8080"
  nfc:
    devices:
      - "/dev/bus/usb:/dev/bus/usb"
      - "\${SERIAL_PATH:-/dev/ttyUSB0}:/dev/ttyUSB0"
`);

  assert.deepEqual(inspection.detectedDeviceRequirements, ["/dev/bus/usb", "/dev/ttyUSB0"]);
  assert.deepEqual(inspection.serviceDeviceRequirements, [
    {
      serviceName: "nfc",
      devicePaths: ["/dev/bus/usb", "/dev/ttyUSB0"]
    }
  ]);
});

test("collects required and optional environment variables across services", () => {
  const inspection = inspect(`
services:
  web:
    environment:
      PORT: "\${PORT:-8080}"
    expose:
      - "\${PORT:-8080}"
  api:
    environment:
      ADMIN_FIXED_PASSWORD: "\${ADMIN_FIXED_PASSWORD}"
      LOG_LEVEL: info
      OPTIONAL_TOKEN:
`);

  assert.deepEqual(inspection.environmentRequirements, [
    {
      name: "ADMIN_FIXED_PASSWORD",
      required: true,
      defaultValue: null,
      services: ["api"]
    },
    {
      name: "OPTIONAL_TOKEN",
      required: true,
      defaultValue: null,
      services: ["api"]
    },
    {
      name: "PORT",
      required: false,
      defaultValue: "8080",
      services: ["web"]
    }
  ]);
});

test("treats empty-string fallback environment variables as required", () => {
  const inspection = inspect(`
services:
  api:
    environment:
      ADMIN_FIXED_PASSWORD: "\${ADMIN_FIXED_PASSWORD:-}"
`);

  assert.deepEqual(inspection.environmentRequirements, [
    {
      name: "ADMIN_FIXED_PASSWORD",
      required: true,
      defaultValue: null,
      services: ["api"]
    }
  ]);
});
