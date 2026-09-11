import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  loadProjectBundleByBuildId,
  toLocalProjectBundle,
  type PublishedProjectBundle,
} from "@webstudio-is/http-client";
import { getDeploymentTarget } from "./db.js";
import { deployToCloudflarePages } from "./cloudflare.js";

// SSG template location - within the monorepo to preserve workspace deps
const TEMPLATE_DIR = process.env.WEBSTUDIO_TEMPLATE_DIR ?? "/app/fixtures/ssg-cloudflare-pages";

interface PublishInput {
  buildId: string;
  builderOrigin: string;
  destination: "saas" | "static";
  branchName: string;
  logProjectName: string;
}

interface PublishResult {
  success: boolean;
  error?: string;
  url?: string;
}

export const handlePublish = async (
  input: PublishInput
): Promise<PublishResult> => {
  console.log(`Publishing build ${input.buildId} from ${input.builderOrigin}`);

  const serviceToken = process.env.TRPC_SERVER_API_TOKEN;
  if (!serviceToken) {
    return { success: false, error: "TRPC_SERVER_API_TOKEN not configured" };
  }

  const cloudflareApiToken = process.env.CF_DEPLOY_TOKEN;
  if (!cloudflareApiToken) {
    return { success: false, error: "CF_DEPLOY_TOKEN not configured" };
  }

  // Fetch the build bundle from Webstudio
  let bundle: PublishedProjectBundle;
  try {
    bundle = await loadProjectBundleByBuildId({
      buildId: input.buildId,
      origin: input.builderOrigin,
      serviceToken,
    });
  } catch (error) {
    console.error("Failed to fetch build bundle:", error);
    return {
      success: false,
      error: `Failed to fetch build bundle: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const projectId = bundle.build.projectId;
  console.log(`Project ID: ${projectId}`);

  // Get deployment target from database
  const target = await getDeploymentTarget(projectId);
  if (!target) {
    return {
      success: false,
      error: `No deployment target configured for project ${projectId}. Add a row to deployment_targets table.`,
    };
  }

  console.log(
    `Deploying to Cloudflare Pages project: ${target.cloudflareProjectName}`
  );

  // Use template directory directly (simpler, works with workspace deps)
  // Note: This doesn't support concurrent builds - add locking/queuing if needed
  const buildDir = TEMPLATE_DIR;

  try {
    // Write .webstudio/config.json
    const webstudioDir = join(buildDir, ".webstudio");
    await mkdir(webstudioDir, { recursive: true });
    await writeFile(
      join(webstudioDir, "config.json"),
      JSON.stringify({ projectId }, null, 2)
    );

    // Write .webstudio/data.json
    const localBundle = toLocalProjectBundle(bundle);
    await writeFile(
      join(webstudioDir, "data.json"),
      JSON.stringify(localBundle, null, 2)
    );

    console.log("Generating React code from Webstudio data...");
    execSync("pnpm cli:local build --template ssg", {
      cwd: buildDir,
      stdio: "inherit",
    });

    console.log("Building static site...");
    execSync("pnpm build", {
      cwd: buildDir,
      stdio: "inherit",
    });

    // Deploy to Cloudflare Pages (vike outputs to dist/client)
    const distDir = join(buildDir, "dist", "client");
    const result = await deployToCloudflarePages(
      {
        accountId: target.cloudflareAccountId,
        apiToken: cloudflareApiToken,
      },
      target.cloudflareProjectName,
      distDir
    );

    return {
      success: true,
      url: result.url,
    };
  } catch (error) {
    console.error("Build/deploy error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const handleUnpublish = async (domain: string): Promise<PublishResult> => {
  console.log(`Unpublish requested for domain: ${domain}`);
  // Cloudflare Pages doesn't have a direct "unpublish" - you'd delete the deployment
  // For now, we just return success
  return { success: true };
};
