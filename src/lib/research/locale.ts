export type ResearchLocale = {
  city: string;
  country: string;
  countryCode: string;
  assumed: boolean;
  cityUnclear: boolean;
};

type Place = {
  needles: string[];
  city: string;
  country: string;
  countryCode: string;
};

const PLACES: Place[] = [
  { needles: ["helsinki"], city: "Helsinki", country: "Finland", countryCode: "FI" },
  { needles: ["finland", "finnish"], city: "Helsinki", country: "Finland", countryCode: "FI" },
  { needles: ["stockholm"], city: "Stockholm", country: "Sweden", countryCode: "SE" },
  { needles: ["sweden", "swedish"], city: "Stockholm", country: "Sweden", countryCode: "SE" },
  { needles: ["oslo"], city: "Oslo", country: "Norway", countryCode: "NO" },
  { needles: ["norway", "norwegian"], city: "Oslo", country: "Norway", countryCode: "NO" },
  { needles: ["copenhagen"], city: "Copenhagen", country: "Denmark", countryCode: "DK" },
  { needles: ["denmark", "danish"], city: "Copenhagen", country: "Denmark", countryCode: "DK" },
  { needles: ["tallinn"], city: "Tallinn", country: "Estonia", countryCode: "EE" },
  { needles: ["estonia", "estonian"], city: "Tallinn", country: "Estonia", countryCode: "EE" },
  { needles: ["berlin"], city: "Berlin", country: "Germany", countryCode: "DE" },
  { needles: ["germany", "german"], city: "Berlin", country: "Germany", countryCode: "DE" },
  { needles: ["amsterdam"], city: "Amsterdam", country: "Netherlands", countryCode: "NL" },
  { needles: ["netherlands", "dutch"], city: "Amsterdam", country: "Netherlands", countryCode: "NL" },
  { needles: ["london"], city: "London", country: "United Kingdom", countryCode: "GB" },
  { needles: ["united kingdom", "uk", "britain", "british"], city: "London", country: "United Kingdom", countryCode: "GB" },
  { needles: ["paris"], city: "Paris", country: "France", countryCode: "FR" },
  { needles: ["france", "french"], city: "Paris", country: "France", countryCode: "FR" },
  { needles: ["new york"], city: "New York", country: "United States", countryCode: "US" },
  { needles: ["san francisco"], city: "San Francisco", country: "United States", countryCode: "US" },
  { needles: ["austin"], city: "Austin", country: "United States", countryCode: "US" },
  { needles: ["united states", "usa", "u.s.", "america", "american"], city: "", country: "United States", countryCode: "US" },
  { needles: ["toronto"], city: "Toronto", country: "Canada", countryCode: "CA" },
  { needles: ["canada", "canadian"], city: "Toronto", country: "Canada", countryCode: "CA" },
  { needles: ["sydney"], city: "Sydney", country: "Australia", countryCode: "AU" },
  { needles: ["australia", "australian"], city: "Sydney", country: "Australia", countryCode: "AU" },
];

const COUNTRIES = new Map<string, { country: string; countryCode: string; city: string }>();
for (const place of PLACES) {
  COUNTRIES.set(place.country.toLowerCase(), {
    country: place.country,
    countryCode: place.countryCode,
    city: place.city,
  });
}

export const DEFAULT_LOCALE: ResearchLocale = {
  city: "Helsinki",
  country: "Finland",
  countryCode: "FI",
  assumed: true,
  cityUnclear: false,
};

export function inferLocale(text: string): ResearchLocale {
  const haystack = text.toLowerCase();
  for (const place of PLACES) {
    const matched = place.needles.some((needle) => mentions(haystack, needle));
    if (!matched) continue;
    if (!place.city) {
      return {
        city: "",
        country: place.country,
        countryCode: place.countryCode,
        assumed: false,
        cityUnclear: true,
      };
    }
    return {
      city: place.city,
      country: place.country,
      countryCode: place.countryCode,
      assumed: false,
      cityUnclear: false,
    };
  }
  return { ...DEFAULT_LOCALE };
}

export function localeFromFields(city: string, country: string): ResearchLocale {
  const known = COUNTRIES.get(country.trim().toLowerCase());
  return {
    city: city.trim(),
    country: known?.country ?? country.trim(),
    countryCode: known?.countryCode ?? "",
    assumed: false,
    cityUnclear: city.trim().length === 0,
  };
}

export function localeLabel(locale: Pick<ResearchLocale, "city" | "country">) {
  return [locale.city.trim(), locale.country.trim()].filter(Boolean).join(", ");
}

function mentions(haystack: string, needle: string) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

// The place research runs for when nobody picked one. A named city wins. A country with no city of its own
// researches the country as a whole. Nothing named falls back to Helsinki, Finland. Both fields are always filled,
// so a run started from the chat bar never stalls on a form.
export function researchPlace(text: string): { city: string; country: string; assumed: boolean } {
  const found = inferLocale(text);
  if (found.city.trim()) return { city: found.city, country: found.country, assumed: found.assumed };
  if (found.cityUnclear) return { city: found.country, country: found.country, assumed: true };
  return { city: DEFAULT_LOCALE.city, country: DEFAULT_LOCALE.country, assumed: true };
}
