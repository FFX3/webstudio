import { parseBuilderUrl } from "@webstudio-is/protocol";

export const getRequestOrigin = (urlStr: string) => {
  const url = new URL(urlStr);

  // Force https in production (TLS terminates at ingress, internal requests are http)
  if (
    process.env.DEPLOYMENT_ENVIRONMENT === "production" &&
    url.protocol === "http:"
  ) {
    url.protocol = "https:";
  }

  return url.origin;
};

export const isCanvas = (urlStr: string): boolean => {
  const url = new URL(urlStr);
  const projectId = url.searchParams.get("projectId");

  return projectId !== null;
};

export const isBuilderUrl = (urlStr: string): boolean => {
  const { projectId } = parseBuilderUrl(urlStr);
  return projectId !== undefined;
};

export const getAuthorizationServerOrigin = (urlStr: string): string => {
  const origin = getRequestOrigin(urlStr);
  const { sourceOrigin } = parseBuilderUrl(origin);
  return sourceOrigin;
};
