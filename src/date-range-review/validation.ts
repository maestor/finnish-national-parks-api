export const MAX_DATE_RANGE_REVIEW_DAYS = 184;

const parseDateOnly = (value: string) => {
  const parts = value.split('-').map(Number);

  if (parts.length !== 3) {
    return null;
  }

  const [year, month, day] = parts;

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

export const validateDateRangeReviewRequest = ({
  endDate,
  startDate
}: {
  endDate: string;
  startDate: string;
}) => {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!start || !end) {
    return 'Start date and end date must be valid calendar dates.';
  }

  if (start > end) {
    return 'Start date must be on or before end date.';
  }

  const inclusiveDayCount =
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  if (inclusiveDayCount > MAX_DATE_RANGE_REVIEW_DAYS) {
    return `Date range review supports at most ${MAX_DATE_RANGE_REVIEW_DAYS} days.`;
  }

  return null;
};
