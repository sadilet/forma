export type CompanyHit = {
  name: string;
  domain: string;
  description: string;
  headcount: string;
  fundingSummary: string;
  headquarters: string;
};

export type PersonHit = {
  name: string;
  roleTitle: string;
  seniority: string;
  companyName: string;
  companyDomain: string;
  location: string;
  profileUrls: string[];
  skills: string[];
  confidence: number | null;
};

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
};

export type ResearchSource = {
  searchCompanies(query: string): Promise<CompanyHit[]>;
  searchPeople(input: { query: string; countries: string[]; minYears: number }): Promise<PersonHit[]>;
  searchNews(input: { query?: string; domain?: string; limit: number }): Promise<WebHit[]>;
  searchWeb(input: { query: string; includeDomains?: string[]; numResults: number; countryCode?: string }): Promise<WebHit[]>;
  scrapeMarkdown(url: string): Promise<string | null>;
  answers(input: { task: string; jsonFormat: Record<string, unknown> }): Promise<{ json: Record<string, unknown>; sources: string[] }>;
};
