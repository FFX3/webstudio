import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

interface CloudflareConfig {
  accountId: string;
  apiToken: string;
}

interface CloudflareApiResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: {
    id: string;
    url: string;
  };
}

const getContentType = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "application/vnd.ms-fontobject",
    xml: "application/xml",
    txt: "text/plain",
    pdf: "application/pdf",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
};

const collectFiles = async (
  dir: string,
  baseDir: string = dir
): Promise<{ path: string; relativePath: string }[]> => {
  const files: { path: string; relativePath: string }[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push({
        path: fullPath,
        relativePath: "/" + relative(baseDir, fullPath),
      });
    }
  }

  return files;
};

const projectExists = async (
  config: CloudflareConfig,
  projectName: string
): Promise<boolean> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects/${projectName}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
    }
  );
  return response.ok;
};

export const ensurePagesProject = async (
  config: CloudflareConfig,
  projectName: string
): Promise<void> => {
  // Check if project exists first
  if (await projectExists(config, projectName)) {
    console.log(`Project ${projectName} exists`);
    return;
  }

  console.log(`Creating project ${projectName}...`);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    }
  );

  if (!response.ok) {
    const data = (await response.json()) as CloudflareApiResponse;
    throw new Error(
      `Failed to create Pages project: ${JSON.stringify(data.errors)}`
    );
  }
  console.log(`Project ${projectName} created`);
};

export const deployToCloudflarePages = async (
  config: CloudflareConfig,
  projectName: string,
  directory: string
): Promise<{ url: string; deploymentId: string }> => {
  console.log(`Deploying ${directory} to Cloudflare Pages project ${projectName}`);

  // Ensure project exists
  await ensurePagesProject(config, projectName);

  // Collect all files
  const files = await collectFiles(directory);
  console.log(`Found ${files.length} files to upload`);

  // Create deployment
  const formData = new FormData();

  // Build manifest
  const manifest: Record<string, string> = {};

  for (const file of files) {
    const content = await readFile(file.path);
    const hash = createHash("sha256").update(content).digest("hex");
    manifest[file.relativePath] = hash;

    // Add file to form data
    const blob = new Blob([content], { type: getContentType(file.path) });
    // Use the hash as the file key for deduplication
    formData.append(hash, blob, file.relativePath);
  }

  formData.append("manifest", JSON.stringify(manifest));

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects/${projectName}/deployments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to deploy to Cloudflare Pages: ${text}`);
  }

  const data = (await response.json()) as CloudflareApiResponse;

  if (!data.success || !data.result) {
    throw new Error(`Deployment failed: ${JSON.stringify(data)}`);
  }

  console.log(`Deployment successful: ${data.result.url}`);

  return {
    url: data.result.url,
    deploymentId: data.result.id,
  };
};
