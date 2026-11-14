# Guardrails

## 1. Honesty (the product's credibility)

- Every finding has a source URL and capture date.
- Ads: never claim revenue, profit or spend. Meta does not publish spend or impressions for commercial ads. "Probably performing" is the strongest allowed wording.
- Products: say "launched" or give a date range only when the source provides real dates.
- Suggestions: each must cite the finding that supports it. Reject any suggestion that does not.
- If a model call returns something the sources do not support, drop it. Prefer a shorter true report.
- Footer on every report: "Built from public information as of {date}. We cannot see your sales or anyone's ad spend."

## 2. Input safety (users type URLs)

User-supplied URLs make this an SSRF risk. Required controls:

- Allow http and https only.
- Resolve the hostname and block private, loopback, link-local and cloud metadata ranges (including IPv6 equivalents) before fetching, and re-check after every redirect.
- Cap redirects, response size and request time.
- Never pass user input into shell commands or file paths.
- Validate and normalize the domain before use.

## 3. Prompt injection

- Scraped page text is untrusted data. Put it in clearly delimited input, never in the instruction section.
- The model returns structured JSON that is schema validated. Free text from the model is never executed or used to choose URLs to fetch without validation.
- No tools with side effects are available to the model in this app.

## 4. Crawling manners

- Respect robots.txt and sitemaps for sites crawled directly.
- Identify the crawler with an honest user agent and a contact address.
- Roughly 1 request per second per host. Back off on errors.
- If a site blocks bots, mark it "unavailable" and stop. Do not work around blocks.
- Meta Ad Library: the official API is limited. Third party readers of the public Ad Library page exist. Terms of service for scraping have not been verified. Jordan must read Meta's current terms and decide. Keep this source behind an interface so it can be swapped or switched off.

## 5. Cost and abuse

- Per link: run quota, expiry, max tokens, max pages fetched.
- Per IP: rate limit.
- Per day and global: budget caps. When a cap is hit, show a friendly "try again tomorrow" and alert Jordan.
- Consider a free bot check on the entry form (for example Cloudflare Turnstile).
- Log cost per run (model tokens plus any paid data calls).

## 6. Privacy

- Store only what is needed: link token, store URL entered, optional email, results, cost.
- Delete results and emails after 30 days (configurable).
- Do not use any data for model training. Do not share it.
- Links are unguessable and `noindex`.
- Mention in the footer that the entered URL is stored to show results.

## 7. Legal and reputational

- Reports state facts from public sources about named competitors. No disparagement, no speculation about their finances.
- This is not legal advice. Jordan should check terms of service for each data source before scaling.
- Check the hosting provider's terms on commercial use for the plan being used (some free tiers restrict commercial use). Not verified here.

## 8. Failure behavior

- Partial results are fine. Show what worked and say what did not.
- Timeouts never leave a spinner forever. After the limit, show the partial report or a clear error.
- Log failures with enough context to fix them. Do not log secrets.
