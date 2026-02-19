import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@/utils/logger";

const log = logger.apollo;
const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  work_email?: string;
};

function getApolloKey(): string {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    log.error("APOLLO_API_KEY environment variable not set");
    throw new Error("APOLLO_API_KEY environment variable not set");
  }
  return apiKey;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

async function parseApolloError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === "string") return data.error;
    if (Array.isArray(data?.errors)) {
      return data.errors
        .map((err: any) => [err?.message, err?.error, err?.code].filter(Boolean).join(" "))
        .join("; ");
    }
    return JSON.stringify(data);
  } catch {
    return await response.text();
  }
}

async function apolloPost(path: string, body: Record<string, unknown>): Promise<Response> {
  const url = `${APOLLO_BASE_URL}/${path}`;
  const start = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": getApolloKey(),
    },
    body: JSON.stringify(body),
  });

  log.debug("Apollo API response", {
    endpoint: path,
    status: response.status,
    statusText: response.statusText,
    durationMs: Math.round(performance.now() - start),
  });
  return response;
}

function toPerson(person: ApolloPerson) {
  const first = person.first_name?.trim() || "";
  const last = person.last_name?.trim() || "";
  const fullName = [first, last].filter(Boolean).join(" ").trim();
  const email = person.email || person.work_email;
  return {
    name: fullName || person.name || "Unknown",
    title: person.title || "Unknown",
    email: email || "",
  };
}

async function searchPeopleByDomain(domain: string, limit: number): Promise<ApolloPerson[]> {
  const searchBody: Record<string, unknown> = {
    q_organization_domains_list: [domain],
    page: 1,
    per_page: Math.min(limit * 2, 50),
  };

  // Prefer technical roles to match existing behavior.
  searchBody.person_titles = ["engineer", "developer", "software", "ml", "ai"];

  const response = await apolloPost("mixed_people/api_search", searchBody);
  if (!response.ok) {
    const errorText = await parseApolloError(response);
    throw new Error(`Apollo people search failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const people = Array.isArray(payload?.people) ? payload.people : [];
  return people as ApolloPerson[];
}

async function enrichPeopleForEmails(people: ApolloPerson[]): Promise<Map<string, string>> {
  const details = people
    .map((p) => (p.id ? { id: p.id } : null))
    .filter((x): x is { id: string } => x !== null);

  if (details.length === 0) return new Map();

  const response = await apolloPost("/people/bulk_match", {
    details,
    reveal_personal_emails: false,
  });
  if (!response.ok) {
    const errorText = await parseApolloError(response);
    log.warn("Apollo bulk enrichment failed; continuing with search results", { error: errorText });
    return new Map();
  }

  const payload = await response.json();
  const matches = Array.isArray(payload?.matches)
    ? payload.matches
    : Array.isArray(payload?.people)
      ? payload.people
      : [];

  const emails = new Map<string, string>();
  for (const m of matches) {
    const id = typeof m?.id === "string" ? m.id : undefined;
    const email =
      typeof m?.email === "string"
        ? m.email
        : typeof m?.work_email === "string"
          ? m.work_email
          : undefined;
    if (id && email) emails.set(id, email);
  }
  return emails;
}

export function createApolloPeopleLookupTool(contactsLimit: number = 10) {
  const limit = Math.min(Math.max(contactsLimit, 1), 100);

  return new DynamicStructuredTool({
    name: "people_lookup",
    description:
      `Find engineers at a company using Apollo.io. Provide company domain (e.g., 'stripe.com'). Returns up to ${limit} contacts with names, titles, and emails.`,
    schema: z.object({
      domain: z.string().describe("Company domain (e.g., 'stripe.com')").optional(),
      company: z.string().describe("Company name (optional fallback)").optional(),
    }),
    func: async ({ domain, company }) => {
      try {
        log.info("People lookup called", { domain, company, limit });

        if (!domain) {
          log.warn("Apollo lookup requires domain for reliable matching", { company });
          return JSON.stringify({
            success: false,
            error: "MISSING_DOMAIN",
            message:
              "Apollo people lookup requires a company domain. You MUST skip this company and continue. Do NOT invent contact information.",
            company: company || "Unknown",
            domain: "Unknown",
            people: [],
            total: 0,
          });
        }

        const candidates = await searchPeopleByDomain(domain, limit);
        const enrichmentEmails = await enrichPeopleForEmails(candidates.slice(0, Math.min(limit * 3, 100)));

        const people = candidates
          .map((c) => {
            const base = toPerson(c);
            const enriched = c.id ? enrichmentEmails.get(c.id) : undefined;
            return { ...base, email: base.email || enriched || "" };
          })
          .filter((p) => p.email)
          .slice(0, limit);

        if (people.length === 0) {
          log.warn("No contacts found - returning explicit failure", {
            domain,
            organization: company || null,
          });
          return JSON.stringify({
            success: false,
            error: "NO_CONTACTS_FOUND",
            message: `Apollo.io returned 0 contacts with emails for ${domain}. You MUST skip this company and move on. DO NOT make up contact information.`,
            company: company || "Unknown",
            domain,
            people: [],
            total: 0,
          });
        }

        log.info("People lookup result", {
          domain,
          peopleFound: people.length,
        });

        return JSON.stringify({
          success: true,
          company: company || null,
          domain,
          people,
          total: people.length,
        });
      } catch (error) {
        const err = toError(error);
        log.error("People lookup request failed", { error: err.message });
        throw err;
      }
    },
  });
}
