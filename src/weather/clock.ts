export const HOUR = 3_600_000;
const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Helsinki',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23'
});

const markerLabel = (instant: number) => {
  const parts = formatter.formatToParts(instant);
  const localHour = Number(parts.find(({ type }) => type === 'hour')?.value);
  return localHour % 3 === 0 ? parts.map(({ value }) => value).join('') : null;
};

export const upcomingWeatherTimes = (now: number) => {
  const slots: number[] = [];
  const labels = new Set<string>();
  const currentHour = Math.floor(now / HOUR) * HOUR;
  const currentLabel = markerLabel(currentHour);
  if (currentLabel !== null) labels.add(currentLabel);

  for (let instant = currentHour + HOUR; slots.length < 4; instant += HOUR) {
    const label = markerLabel(instant);
    if (label !== null && !labels.has(label)) {
      slots.push(instant);
      labels.add(label);
    }
  }
  return slots;
};
