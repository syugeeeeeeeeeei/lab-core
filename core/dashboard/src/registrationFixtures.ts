import type { RegistrationFixture } from "./types";

const rootDomain = "lab.localhost";

export const registrationFixtures: RegistrationFixture[] = [
  {
    id: "oruca_standard",
    label: "OruCa想定 (NFCあり)",
    payload: {
      name: "oruca-test",
      description: "OruCa 構成を想定した登録テスト",
      repositoryUrl: "https://github.com/example/oruca",
      defaultBranch: "main",
      composePath: "docker-compose.yml",
      publicServiceName: "oruca-web",
      publicPort: 80,
      hostname: `oruca-test.${rootDomain}`,
      mode: "standard",
      keepVolumesOnRebuild: true,
      deviceRequirements: ["/dev/bus/usb"],
      envOverrides: {}
    }
  },
  {
    id: "simple_web",
    label: "シンプルWeb",
    payload: {
      name: "homepage-test",
      description: "単体Webアプリの登録テスト",
      repositoryUrl: "https://github.com/example/homepage",
      defaultBranch: "main",
      composePath: "docker-compose.yml",
      publicServiceName: "web",
      publicPort: 3000,
      hostname: `homepage-test.${rootDomain}`,
      mode: "standard",
      keepVolumesOnRebuild: true,
      deviceRequirements: [],
      envOverrides: {}
    }
  },
  {
    id: "headless_api",
    label: "Headless API",
    payload: {
      name: "api-test",
      description: "Headless API サービス登録テスト",
      repositoryUrl: "https://github.com/example/headless-api",
      defaultBranch: "main",
      composePath: "docker-compose.yml",
      publicServiceName: "api",
      publicPort: 8080,
      hostname: `api-test.${rootDomain}`,
      mode: "headless",
      keepVolumesOnRebuild: true,
      deviceRequirements: [],
      envOverrides: {}
    }
  }
];
