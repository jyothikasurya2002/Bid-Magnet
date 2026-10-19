// Date labels with fixed English abbreviations. Intl's "en-GB" output differs between
// Node and browsers ("Sept" vs "Sep"), which breaks hydration.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Options = { weekday?: boolean; day?: boolean; year?: "numeric" | "2-digit" };

export function dateFormat({ weekday = false, day = true, year }: Options) {
  return {
    format(date: Date) {
      const parts = [
        weekday ? WEEKDAYS[date.getDay()] : null,
        day ? String(date.getDate()) : null,
        MONTHS[date.getMonth()],
        year === "numeric" ? String(date.getFullYear()) : year === "2-digit" ? String(date.getFullYear()).slice(2) : null,
      ];
      return parts.filter(Boolean).join(" ");
    },
  };
}

// Time of day in Spain, the same on the server and in the browser.
export const SPAIN_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Madrid",
});
