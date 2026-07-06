import { getCurrentUser } from "@repo/shared/auth/server";
import { isOperationFeatureEnabled } from "@repo/shared/system-settings";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { SystemDocsContent } from "@/features/docs/system-docs";

export default async function BackendHelpPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/${locale}/sign-in`);
  }
  if (!(await isOperationFeatureEnabled("systemDocs"))) {
    redirect(`/${locale}/dashboard`);
  }

  return <SystemDocsContent locale={locale} />;
}
