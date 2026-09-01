import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { authenticator } from "~/services/auth.server";
import { dashboardPath, isDashboard, loginPath } from "~/shared/router-utils";
import { clearReturnToCookie, returnToPath } from "~/services/cookie.server";
import { AUTH_PROVIDERS } from "~/shared/session";
import { preventCrossOriginCookie } from "~/services/no-cross-origin-cookie";
import { redirect, setNoStoreToRedirect } from "~/services/no-store-redirect";
import { allowedDestinations } from "~/services/destinations.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (false === isDashboard(request)) {
    throw new Response("Not Found", {
      status: 404,
    });
  }

  preventCrossOriginCookie(request);
  allowedDestinations(request, ["document"]);

  const returnTo = (await returnToPath(request)) ?? dashboardPath();

  try {
    await authenticator.authenticate("oidc", request, {
      successRedirect: returnTo,
      throwOnError: true,
    });
  } catch (error) {
    if (error instanceof Response) {
      return setNoStoreToRedirect(await clearReturnToCookie(request, error));
    }

    const message = error instanceof Error ? error?.message : "unknown error";

    console.error({
      error,
      extras: {
        loginMethod: AUTH_PROVIDERS.LOGIN_OIDC,
      },
    });
    return redirect(
      loginPath({
        error: AUTH_PROVIDERS.LOGIN_OIDC,
        message,
        returnTo,
      })
    );
  }
};
