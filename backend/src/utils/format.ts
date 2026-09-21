export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

export const COURSE_TYPE_LABEL: Record<string, string> = {
  EBOOK: "E-Book",
  VIDEO: "Recorded Video Course",
  ZOOM: "7-Day Zoom Course",
  CENTRE: "3-Day Academy Centre Course",
};
