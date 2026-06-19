export const createParkSlug = (value: string) => {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'park';
};

export const normalizeParkUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const normalizedInput =
    value.startsWith('http://') || value.startsWith('https://')
      ? value
      : value.startsWith('/')
        ? `https://www.luontoon.fi${value}`
        : `https://${value}`;

  try {
    const url = new URL(normalizedInput);
    const pathname = url.pathname.replace(/\/+$/, '');
    const normalizedPath = pathname || '/';
    const normalizedUrl = new URL(url.toString());

    normalizedUrl.pathname = normalizedPath;

    return normalizedPath === '/'
      ? `${normalizedUrl.origin}${normalizedUrl.search}${normalizedUrl.hash}`
      : normalizedUrl.toString();
  } catch {
    return null;
  }
};
