const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function complete(systemPrompt, userPrompt, maxTokens) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: process.env.AI_MODEL || 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return message.content[0].text;
    } catch (err) {
      const isRateLimit = err.status === 429 || err.status === 529;
      if (isRateLimit && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt + 1) * 5000;
        console.warn(`Rate limited (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { complete };
