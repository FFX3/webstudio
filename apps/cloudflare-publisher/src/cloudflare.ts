import { execSync } from "node:child_process";

interface CloudflareConfig {
  accountId: string;
  apiToken: string;
}

export const deployToCloudflarePages = async (
  config: CloudflareConfig,
  projectName: string,
  directory: string
): Promise<{ url: string; deploymentId: string }> => {
  console.log(`Deploying ${directory} to Cloudflare Pages project ${projectName}`);

  const result = execSync(
    `pnpm wrangler pages deploy "${directory}" --project-name="${projectName}"`,
    {
      cwd: directory,
      encoding: "utf-8",
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: config.accountId,
        CLOUDFLARE_API_TOKEN: config.apiToken,
      },
    }
  );

  console.log(result);

  // Parse deployment URL from wrangler output
  const urlMatch = result.match(/https:\/\/[^\s]+\.pages\.dev/);
  const url = urlMatch ? urlMatch[0] : `https://${projectName}.pages.dev`;

  return {
    url,
    deploymentId: "wrangler-deploy",
  };
};
