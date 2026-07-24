const normalizeDisplayNamePart = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const deriveLocationDisplayName = (input: {
  addressLine1?: string | null | undefined;
  formatted?: string | null | undefined;
  name?: string | null | undefined;
}) => {
  return (
    normalizeDisplayNamePart(input.name) ??
    normalizeDisplayNamePart(input.addressLine1) ??
    normalizeDisplayNamePart(input.formatted)
  );
};

export const deriveDisplayNameFromLabel = (label: string) => {
  const normalizedLabel = normalizeDisplayNamePart(label) ?? '';

  return (
    normalizedLabel
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? normalizedLabel
  );
};
