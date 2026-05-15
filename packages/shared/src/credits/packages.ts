import { SUBSCRIPTION_MONTHLY_CREDITS } from "../config/payment";
import { getRuntimeSettingNumber } from "../system-settings";
import {
  CREDIT_PACKAGES,
  PAY_AS_YOU_GO_PACKAGE_ID,
  isCreditPackageVisible,
  type CreditPackage,
  type CreditPackageId,
} from "./config";

export type RuntimeCreditPackage = Omit<CreditPackage, "credits" | "price"> & {
  credits: number;
  price: number;
};

const STARTER_DEFAULT_PRICE = 20;

export async function getRuntimeCreditPackages(options?: {
  includeHidden?: boolean;
}) {
  const [starterCredits, starterPrice] = await Promise.all([
    getRuntimeSettingNumber(
      "PLAN_STARTER_MONTHLY_CREDITS",
      SUBSCRIPTION_MONTHLY_CREDITS.starter,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "PLAN_STARTER_MONTHLY_AMOUNT",
      STARTER_DEFAULT_PRICE,
      { positive: true }
    ),
  ]);

  const packages = CREDIT_PACKAGES.map((pkg) => {
    if (pkg.id !== PAY_AS_YOU_GO_PACKAGE_ID) {
      return pkg;
    }

    return {
      ...pkg,
      credits: starterCredits,
      price: starterPrice,
    };
  }) as RuntimeCreditPackage[];

  if (options?.includeHidden) {
    return packages;
  }

  return packages.filter((pkg) => isCreditPackageVisible(pkg));
}

export async function getRuntimeCreditPackageById(
  packageId: string,
  options?: { includeHidden?: boolean }
) {
  const packages = await getRuntimeCreditPackages(options);
  return packages.find((pkg) => pkg.id === (packageId as CreditPackageId));
}
