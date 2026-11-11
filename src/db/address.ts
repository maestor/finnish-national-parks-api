export const toAddress = (
  locationLabel: string,
  postalCode: string | null,
  postalOffice: string | null
) => {
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const normalizedLocationLabel = locationLabel.trim();
  const normalizedPostalCode = postalCode?.trim() ?? '';
  const normalizedPostalOffice = capitalize(postalOffice?.trim().toLowerCase() ?? '');
  const postalLocation = [normalizedPostalCode, normalizedPostalOffice].filter(Boolean).join(' ');

  if (!normalizedLocationLabel || normalizedLocationLabel === '-') {
    return postalLocation;
  }

  if (!postalLocation) {
    return normalizedLocationLabel;
  }

  if (normalizedLocationLabel === normalizedPostalOffice) {
    return normalizedPostalCode
      ? `${normalizedLocationLabel}, ${normalizedPostalCode}`
      : normalizedLocationLabel;
  }

  return `${normalizedLocationLabel}, ${postalLocation}`;
};
