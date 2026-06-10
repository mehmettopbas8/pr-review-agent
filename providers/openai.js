const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function complete(systemPrompt, userPrompt, maxTokens) {
  const response = await client.chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4o',
    max_tokens: maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return response.choices[0].message.content;
}

module.exports = { complete };
