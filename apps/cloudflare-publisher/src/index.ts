import { createServer } from "node:http";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { handlePublish, handleUnpublish } from "./publish.js";
import { closePool } from "./db.js";

const t = initTRPC.create();

const publishInput = z.object({
  buildId: z.string(),
  builderOrigin: z.string(),
  githubSha: z.string().optional(),
  destination: z.enum(["saas", "static"]),
  branchName: z.string(),
  logProjectName: z.string(),
});

const unpublishInput = z.object({
  domain: z.string(),
});

const output = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

const appRouter = t.router({
  deployment: t.router({
    publish: t.procedure
      .input(publishInput)
      .output(output)
      .mutation(async ({ input }) => {
        console.log("Received publish request:", input.logProjectName);
        try {
          const result = await handlePublish(input);
          if (result.success) {
            console.log(`Published successfully: ${result.url}`);
            return { success: true as const };
          } else {
            console.error(`Publish failed: ${result.error}`);
            return { success: false as const, error: result.error ?? "Unknown error" };
          }
        } catch (error) {
          console.error("Publish error:", error);
          return {
            success: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    unpublish: t.procedure
      .input(unpublishInput)
      .output(output)
      .mutation(async ({ input }) => {
        console.log("Received unpublish request:", input.domain);
        try {
          const result = await handleUnpublish(input.domain);
          if (result.success) {
            return { success: true as const };
          } else {
            return { success: false as const, error: result.error ?? "Unknown error" };
          }
        } catch (error) {
          console.error("Unpublish error:", error);
          return {
            success: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  }),
  domain: t.router({}),
});

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const expectedToken = process.env.TRPC_SERVER_API_TOKEN;

const server = createServer(async (req, res) => {
  // Health check - handle before anything else
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Auth check for TRPC routes
  if (expectedToken && req.headers.authorization !== expectedToken) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Handle TRPC requests (strip /trpc prefix if present)
  const path = req.url?.replace(/^\/trpc/, "") ?? "/";
  req.url = path;

  await nodeHTTPRequestHandler({
    router: appRouter,
    createContext: () => ({}),
    req,
    res,
    path: path.slice(1), // Remove leading slash for TRPC
  });
});

server.listen(PORT);
console.log(`Cloudflare Publisher service listening on port ${PORT}`);
console.log(`Health check: http://localhost:${PORT}/health`);

const shutdown = async () => {
  console.log("Shutting down...");
  server.close();
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
