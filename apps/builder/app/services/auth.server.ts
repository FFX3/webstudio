import { Authenticator } from "remix-auth";
import { FormStrategy } from "remix-auth-form";
import { GitHubStrategy, type GitHubProfile } from "remix-auth-github";
import { GoogleStrategy, type GoogleProfile } from "remix-auth-google";
import { OAuth2Strategy } from "remix-auth-oauth2";
import * as db from "~/shared/db";
import { sessionStorage } from "~/services/session.server";
import { AUTH_PROVIDERS } from "~/shared/session";
import { authCallbackPath, isBuilder } from "~/shared/router-utils";
import { getUserById } from "~/shared/db/user.server";
import env from "~/env/env.server";
import { builderAuthenticator } from "./builder-auth.server";
import { staticEnv } from "~/env/env.static.server";
import type { SessionData } from "./auth.server.utils";
import { createContext } from "~/shared/context.server";

const transformRefToAlias = (input: string) => {
  const rawAlias = input.endsWith(".staging") ? input.slice(0, -8) : input;

  return rawAlias
    .replace(/[^a-zA-Z0-9_-]/g, "") // Remove all characters except a-z, A-Z, 0-9, _ and -
    .toLowerCase() // Convert to lowercase
    .replace(/_/g, "-") // Replace underscores with hyphens
    .replace(/-+/g, "-"); // Replace multiple hyphens with a single hyphen
};

export const callbackOrigin =
  env.DEPLOYMENT_ENVIRONMENT === "production"
    ? env.DEPLOYMENT_URL
    : env.DEPLOYMENT_ENVIRONMENT === "preview" ||
        env.DEPLOYMENT_ENVIRONMENT === "development"
      ? `https://${transformRefToAlias(staticEnv.GITHUB_REF_NAME ?? "main")}.${env.DEPLOYMENT_ENVIRONMENT}.webstudio.is`
      : `https://wstd.dev:${env.PORT || 5173}`;

const strategyCallback = async ({
  profile,
  request,
}: {
  profile: GitHubProfile | GoogleProfile;
  request: Request;
}) => {
  const context = await createContext(request);

  try {
    const user = await db.user.createOrLoginWithOAuth(context, profile);
    return { userId: user.id, createdAt: Date.now() };
  } catch (error) {
    if (error instanceof Error) {
      console.error({
        error,
        extras: {
          loginMethod: AUTH_PROVIDERS.LOGIN_DEV,
        },
      });
    }
    throw error;
  }
};

// Create an instance of the authenticator, pass a generic with what
// strategies will return and will store in the session
export const authenticator = new Authenticator<SessionData>(sessionStorage, {
  throwOnError: true,
});

if (env.GH_CLIENT_ID && env.GH_CLIENT_SECRET) {
  const github = new GitHubStrategy(
    {
      clientID: env.GH_CLIENT_ID,
      clientSecret: env.GH_CLIENT_SECRET,
      callbackURL: `${callbackOrigin}${authCallbackPath({ provider: "github" })}`,
    },
    strategyCallback
  );
  authenticator.use(github, "github");
}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  const google = new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${callbackOrigin}${authCallbackPath({ provider: "google" })}`,
    },
    strategyCallback
  );
  authenticator.use(google, "google");
}

if (env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID) {
  // Fetch OIDC discovery document and set up strategy
  fetch(`${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`)
    .then((res) => res.json())
    .then((config) => {
      const oidc = new OAuth2Strategy(
        {
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET || "",
          redirectURI: `${callbackOrigin}${authCallbackPath({ provider: "oidc" })}`,
          authorizationEndpoint: config.authorization_endpoint,
          tokenEndpoint: config.token_endpoint,
          scopes: ["openid", "email", "profile"],
        },
        async ({ tokens, request }) => {
          // Fetch user info from GoTrue /user endpoint (not OIDC userinfo)
          // GoTrue's /user returns email directly, /oauth/userinfo may not
          const userinfoUrl = env.OIDC_ISSUER_URL + "/user";
          console.log("[OIDC] Fetching user info from:", userinfoUrl);
          const response = await fetch(userinfoUrl, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });
          console.log("[OIDC] Response status:", response.status);
          const profile = await response.json();
          console.log("[OIDC] Profile from /user:", JSON.stringify(profile, null, 2));
          console.log("[OIDC] Email:", profile.email);
          return strategyCallback({
            profile: {
              // GoTrue /user returns id, not sub
              id: profile.id || profile.sub,
              displayName: profile.user_metadata?.name || profile.email,
              emails: [{ value: profile.email }],
              photos: profile.user_metadata?.picture ? [{ value: profile.user_metadata.picture }] : [],
              provider: "oidc",
              _json: profile,
            } as GitHubProfile,
            request,
          });
        }
      );
      authenticator.use(oidc, "oidc");
    })
    .catch((err) => {
      console.error("Failed to configure OIDC:", err);
    });
}

if (env.DEV_LOGIN === "true") {
  authenticator.use(
    new FormStrategy(async ({ form, request }) => {
      const secretValue = form.get("secret");

      if (secretValue == null) {
        throw new Error("Secret is required");
      }

      const secret = secretValue.toString();
      const emailValue = form.get("email");
      const email =
        emailValue != null && emailValue.toString().trim() !== ""
          ? emailValue.toString().trim()
          : "hello@webstudio.is";

      if (secret === env.AUTH_SECRET) {
        try {
          const context = await createContext(request);

          const user = await db.user.createOrLoginWithDev(context, email);
          return {
            userId: user.id,
            createdAt: Date.now(),
          };
        } catch (error) {
          if (error instanceof Error) {
            console.error({
              error,
              extras: {
                loginMethod: AUTH_PROVIDERS.LOGIN_DEV,
              },
            });
          }
          throw error;
        }
      }

      throw new Error("Secret is incorrect");
    }),
    "dev"
  );
}

export const findAuthenticatedUser = async (request: Request) => {
  const user = isBuilder(request)
    ? await builderAuthenticator.isAuthenticated(request)
    : await authenticator.isAuthenticated(request);

  if (user == null) {
    return null;
  }
  const context = await createContext(request);

  try {
    return await getUserById(context, user.userId);
  } catch (error) {
    return null;
  }
};
