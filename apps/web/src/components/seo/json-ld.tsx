import type { BrandingConfig } from "@repo/shared/config/branding";
import {
  type ArticleSchemaInput,
  type BreadcrumbItem,
  type FAQItem,
  generateArticleSchema,
  generateBreadcrumbSchema,
  generateFAQSchema,
  generateOrganizationSchema,
  generateSoftwareApplicationSchema,
  generateWebSiteSchema,
} from "@/lib/seo/json-ld";

type LocaleType = "en" | "zh";

/**
 * Generic JSON-LD script injector
 */
function JsonLdScript({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 必须以 script 内容注入，数据经 JSON.stringify 序列化而非拼接 HTML。
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * WebSite + Organization (typically used in layout)
 *
 * @param locale - 当前页面语言。
 * @param branding - 管理员配置的品牌信息。
 * @returns WebSite 与 Organization JSON-LD script。
 * @sideEffects 向页面注入结构化数据 script。
 */
export function SiteJsonLd({
  locale,
  branding,
  baseUrl,
}: {
  locale: LocaleType;
  branding?: BrandingConfig;
  baseUrl?: string;
}) {
  return (
    <>
      <JsonLdScript data={generateWebSiteSchema(locale, branding, baseUrl)} />
      <JsonLdScript data={generateOrganizationSchema(branding, baseUrl)} />
    </>
  );
}

/**
 * Article (for blog posts)
 */
export function ArticleJsonLd(props: ArticleSchemaInput) {
  return <JsonLdScript data={generateArticleSchema(props)} />;
}

/**
 * FAQ Page
 */
export function FAQJsonLd({ faqs }: { faqs: FAQItem[] }) {
  if (!faqs || faqs.length === 0) return null;
  return <JsonLdScript data={generateFAQSchema(faqs)} />;
}

/**
 * Breadcrumbs
 */
export function BreadcrumbJsonLd({
  items,
  baseUrl,
}: {
  items: BreadcrumbItem[];
  baseUrl?: string;
}) {
  if (!items || items.length === 0) return null;
  return <JsonLdScript data={generateBreadcrumbSchema(items, baseUrl)} />;
}

/**
 * Software Application (for product pages)
 *
 * @param locale - 当前页面语言。
 * @param branding - 管理员配置的品牌信息。
 * @returns SoftwareApplication JSON-LD script。
 * @sideEffects 向页面注入结构化数据 script。
 */
export function SoftwareAppJsonLd({
  locale,
  branding,
  baseUrl,
}: {
  locale: LocaleType;
  branding?: BrandingConfig;
  baseUrl?: string;
}) {
  return (
    <JsonLdScript
      data={generateSoftwareApplicationSchema(locale, branding, baseUrl)}
    />
  );
}

/**
 * Combined schema for homepage
 */
export function HomePageJsonLd({
  locale,
  faqs,
  baseUrl,
}: {
  locale: LocaleType;
  faqs?: FAQItem[];
  baseUrl?: string;
}) {
  return (
    <>
      <SiteJsonLd locale={locale} baseUrl={baseUrl} />
      <SoftwareAppJsonLd locale={locale} baseUrl={baseUrl} />
      {faqs && faqs.length > 0 && <FAQJsonLd faqs={faqs} />}
    </>
  );
}
