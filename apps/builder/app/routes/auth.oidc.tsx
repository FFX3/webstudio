import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { authenticator } from "~/services/auth.server";
import { dashboardPath, isDashboard, loginPath } from "~/shared/router-utils";
import { AUTH_PROVIDERS } from "~/shared/session";
import { clearReturnToCookie, returnToPath } from "~/services/cookie.server";
import { preventCrossOriginCookie } from "~/services/no-cross-origin-cookie";
import { redirect, setNoStoreToRedirect } from "~/services/no-store-redirect";

export default function Oidc() {
  return null;
}

export const loader = (_args: LoaderFunctionArgs) => redirect("/login");

export const action = async ({ request }: ActionFunctionArgs) => {
  if (false === isDashboard(request)) {
    throw new Response("Not Found", {
      status: 404,
    });
  }

  preventCrossOriginCookie(request);

  const returnTo = (await returnToPath(request)) ?? dashboardPath();

  try {
    return await authenticator.authenticate("oidc", request, {
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
        message: message,
        returnTo,
      })
    );
  }
};
