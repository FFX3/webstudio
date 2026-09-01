import type { Database } from "./__generated__/db-types";
import { PostgrestClient } from "@supabase/postgrest-js";
import { fetch as undiciFetch } from "undici";
export type { Database } from "./__generated__/db-types";

export type Client = PostgrestClient<Database>;

export const createClient = (url: string, apiKey: string): Client => {
  const client = new PostgrestClient<Database>(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    // Use native Node fetch (undici) to bypass Remix's web-fetch polyfill
    // which has socket hang up issues
    fetch: undiciFetch as unknown as typeof fetch,
  });

  return client;
};
