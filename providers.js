require('dotenv').config();

function getProvider() {
  const name = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();

  if (name === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return {
      async complete(systemPrompt, userPrompt, maxTokens) {
        const msg = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const block = msg.content.find(b => b.type === 'text');
        return block ? block.text : '';
      },
    };
  }

  if (name === 'openai') {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return {
      async complete(systemPrompt, userPrompt, maxTokens) {
        const res = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
        return res.choices[0]?.message?.content || '';
      },
    };
  }

  if (name === 'gemini') {
    const { GoogleGenAI } = require('@google/genai');
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return {
      async complete(systemPrompt, userPrompt, maxTokens) {
        const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        const res = await client.models.generateContent({
          model,
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: maxTokens,
          },
          contents: userPrompt,
        });
        return res.text || '';
      },
    };
  }

  throw new Error(`Unknown AI_PROVIDER: "${name}". Use "anthropic", "openai", or "gemini".`);
}

module.exports = { getProvider };
