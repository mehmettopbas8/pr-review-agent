const { GoogleGenAI } = require('@google/genai');

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function complete(systemPrompt, userPrompt, maxTokens) {
  const response = await client.models.generateContent({
    model: process.env.AI_MODEL || 'gemini-2.0-flash',
    config: { systemInstruction: systemPrompt, maxOutputTokens: maxTokens, temperature: 0 },
    contents: userPrompt,
  });
  return response.text;
}

module.exports = { complete };
