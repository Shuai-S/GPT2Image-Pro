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
 *
 * 将结构化数据安全注入 <script type="application/ld+json">。
 * 对序列化结果中的 "<" 字符进行转义（<），防止恶意数据通过
 * </script> 标签提前闭合脚本块实施 XSS 注入。
 */
function JsonLdScript({ data }: { data: object }) {
  // 转义 < 为 Unicode 转义序列，防止 </script> 注入
  const safeJson = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * WebSite + Organization (typically used in layout)
 */
export function SiteJsonLd({ locale }: { locale: LocaleType }) {
  return (
    <>
      <JsonLdScript data={generateWebSiteSchema(locale)} />
      <JsonLdScript data={generateOrganizationSchema()} />
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
export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null;
  return <JsonLdScript data={generateBreadcrumbSchema(items)} />;
}

/**
 * Software Application (for product pages)
 */
export function SoftwareAppJsonLd({ locale }: { locale: LocaleType }) {
  return <JsonLdScript data={generateSoftwareApplicationSchema(locale)} />;
}

/**
 * Combined schema for homepage
 */
export function HomePageJsonLd({
  locale,
  faqs,
}: {
  locale: LocaleType;
  faqs?: FAQItem[];
}) {
  return (
    <>
      <SiteJsonLd locale={locale} />
      <SoftwareAppJsonLd locale={locale} />
      {faqs && faqs.length > 0 && <FAQJsonLd faqs={faqs} />}
    </>
  );
}
