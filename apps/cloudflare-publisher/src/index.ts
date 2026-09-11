import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { handlePublish, handleUnpublish } from "./publish.js";
import { closePool } from "./db.js";

// TRPC setup
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
  z.object({
    success: z.literal(true),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Deployment router implementation
const deploymentRouter = t.router({
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
});

// Domain router (stub for compatibility)
const domainRouter = t.router({});

// Combined router matching SharedRouter structure
const appRouter = t.router({
  deployment: deploymentRouter,
  domain: domainRouter,
});

type AppRouter = typeof appRouter;

// Simple TRPC HTTP handler for batch requests
const handleTrpcRequest = async (
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> => {
  // Parse URL
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Handle health check (no auth required)
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Verify authorization for all other endpoints
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.TRPC_SERVER_API_TOKEN;

  if (expectedToken && authHeader !== expectedToken) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Parse TRPC batch request
  // URL format: /trpc/deployment.publish,deployment.unpublish?batch=1&input=...
  if (!pathname.startsWith("/trpc/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const procedures = pathname.replace("/trpc/", "").split(",");
  const inputParam = url.searchParams.get("input");

  let inputs: unknown[] = [];
  if (inputParam) {
    try {
      const parsed = JSON.parse(inputParam);
      inputs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid input" }));
      return;
    }
  }

  // For POST requests, also read body
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf-8");
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) {
          inputs = parsed;
        } else if (parsed.input !== undefined) {
          inputs = [parsed.input];
        }
      } catch {
        // Ignore body parse errors, use URL params
      }
    }
  }

  const results: unknown[] = [];

  for (let i = 0; i < procedures.length; i++) {
    const procedure = procedures[i];
    const input = inputs[i] ?? {};

    try {
      if (procedure === "deployment.publish") {
        const validatedInput = publishInput.parse(input);
        console.log("Received publish request:", validatedInput.logProjectName);
        const result = await handlePublish(validatedInput);
        if (result.success) {
          console.log(`Published successfully: ${result.url}`);
          results.push({ result: { data: { success: true } } });
        } else {
          console.error(`Publish failed: ${result.error}`);
          results.push({ result: { data: { success: false, error: result.error ?? "Unknown error" } } });
        }
      } else if (procedure === "deployment.unpublish") {
        const validatedInput = unpublishInput.parse(input);
        console.log("Received unpublish request:", validatedInput.domain);
        const result = await handleUnpublish(validatedInput.domain);
        if (result.success) {
          results.push({ result: { data: { success: true } } });
        } else {
          results.push({ result: { data: { success: false, error: result.error ?? "Unknown error" } } });
        }
      } else {
        results.push({ error: { message: `Unknown procedure: ${procedure}` } });
      }
    } catch (error) {
      console.error("Error handling procedure:", error);
      results.push({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(results));
};

// Start server
const PORT = parseInt(process.env.PORT ?? "4000", 10);

const server = createServer(handleTrpcRequest);

server.listen(PORT, () => {
  console.log(`Cloudflare Publisher service listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down...");
  server.close();
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
