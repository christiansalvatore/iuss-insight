const ALLOWED_EMAIL_DOMAIN = "iusspavia.it";

export function isAllowedInstitutionEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export function getAllowedEmailDomain(): string {
  return ALLOWED_EMAIL_DOMAIN;
}

