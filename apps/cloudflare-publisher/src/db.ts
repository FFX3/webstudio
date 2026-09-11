import pg from "pg";

const { Pool } = pg;

export interface DeploymentTarget {
  projectId: string;
  cloudflareProjectName: string;
  cloudflareAccountId: string;
  customDomain: string | null;
}

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
  if (pool === null) {
    const connectionString = process.env.CONFIG_DATABASE_URL;
    if (!connectionString) {
      throw new Error("CONFIG_DATABASE_URL environment variable is required");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
};

export const getDeploymentTarget = async (
  projectId: string
): Promise<DeploymentTarget | null> => {
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      project_id: string;
      cloudflare_project_name: string;
      cloudflare_account_id: string;
      custom_domain: string | null;
    }>(
      `SELECT project_id, cloudflare_project_name, cloudflare_account_id, custom_domain
       FROM deployment_targets
       WHERE project_id = $1`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      projectId: row.project_id,
      cloudflareProjectName: row.cloudflare_project_name,
      cloudflareAccountId: row.cloudflare_account_id,
      customDomain: row.custom_domain,
    };
  } finally {
    client.release();
  }
};

export const closePool = async (): Promise<void> => {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
};
