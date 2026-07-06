"use server";

import { adminAction } from "@repo/shared/safe-action";
import { setSystemSettings } from "@repo/shared/system-settings";
import { z } from "zod";

export const updateMarketingSlaStatusVisibilityAction = adminAction
  .metadata({ action: "marketing.slaStatus.visibility" })
  .schema(z.object({ enabled: z.boolean() }))
  .action(async ({ parsedInput, ctx }) => {
    await setSystemSettings(
      [
        {
          key: "MARKETING_SLA_STATUS_ENABLED",
          value: parsedInput.enabled,
        },
      ],
      ctx.userId
    );

    return {
      enabled: parsedInput.enabled,
      message: parsedInput.enabled ? "首页 SLA 已开启" : "首页 SLA 已关闭",
    };
  });
