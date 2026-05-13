const ALLOWED_REGISTRATION_EMAIL_DOMAINS = new Set([
  "163.com",
  "126.com",
  "qq.com",
  "gmail.com",
]);

export const ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST = Array.from(
  ALLOWED_REGISTRATION_EMAIL_DOMAINS
);

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedRegistrationEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1];
  return Boolean(domain && ALLOWED_REGISTRATION_EMAIL_DOMAINS.has(domain));
}

export function getAllowedRegistrationEmailMessage() {
  return `Please use one of these email domains: ${ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST.join(", ")}.`;
}
