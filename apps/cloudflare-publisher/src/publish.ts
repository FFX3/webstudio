import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  loadProjectBundleByBuildId,
  type PublishedProjectBundle,
} from "@webstudio-is/http-client";
import { getDeploymentTarget } from "./db.js";
import { deployToCloudflarePages } from "./cloudflare.js";

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

const generateStaticSite = async (
  bundle: PublishedProjectBundle,
  outputDir: string
): Promise<void> => {
  // Create output directory
  await mkdir(outputDir, { recursive: true });

  const { pages, assets, build } = bundle;

  // For each page, generate an HTML file
  for (const page of pages) {
    const pagePath = page.path === "" ? "index" : page.path.replace(/^\//, "");
    const htmlPath = join(outputDir, `${pagePath}.html`);

    // Ensure parent directory exists
    const parentDir = join(outputDir, ...pagePath.split("/").slice(0, -1));
    if (parentDir !== outputDir && pagePath.includes("/")) {
      await mkdir(parentDir, { recursive: true });
    }

    // Generate basic HTML
    // TODO: In a full implementation, this would use the CLI's prebuild logic
    // to generate proper React components and styles
    const title =
      typeof page.title === "string" ? page.title.replace(/^"|"$/g, "") : page.name;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
  </style>
</head>
<body>
  <h1>${page.name}</h1>
  <p>This page was generated from Webstudio.</p>
  <p>Build ID: ${build.id}</p>
  <p>Project: ${bundle.projectTitle}</p>
</body>
</html>`;

    await writeFile(htmlPath, html, "utf-8");
  }

  // Download and save assets
  for (const asset of assets) {
    if (asset.type === "image" || asset.type === "font") {
      const assetDir = join(outputDir, "assets");
      await mkdir(assetDir, { recursive: true });
      // TODO: Download actual asset files from bundle.origin
    }
  }

  console.log(`Generated ${pages.length} pages to ${outputDir}`);
};

export const handlePublish = async (
  input: PublishInput
): Promise<PublishResult> => {
  console.log(`Publishing build ${input.buildId} from ${input.builderOrigin}`);

  const serviceToken = process.env.WEBSTUDIO_SERVICE_TOKEN;
  if (!serviceToken) {
    return { success: false, error: "WEBSTUDIO_SERVICE_TOKEN not configured" };
  }

  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!cloudflareApiToken) {
    return { success: false, error: "CLOUDFLARE_API_TOKEN not configured" };
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

  // Create temporary directory for build output
  const buildDir = join(tmpdir(), `webstudio-build-${randomUUID()}`);

  try {
    // Generate static site
    await generateStaticSite(bundle, buildDir);

    // Deploy to Cloudflare Pages
    const result = await deployToCloudflarePages(
      {
        accountId: target.cloudflareAccountId,
        apiToken: cloudflareApiToken,
      },
      target.cloudflareProjectName,
      buildDir
    );

    return {
      success: true,
      url: result.url,
    };
  } finally {
    // Cleanup temp directory
    try {
      await rm(buildDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
};

export const handleUnpublish = async (domain: string): Promise<PublishResult> => {
  console.log(`Unpublish requested for domain: ${domain}`);
  // Cloudflare Pages doesn't have a direct "unpublish" - you'd delete the deployment
  // For now, we just return success
  return { success: true };
};
