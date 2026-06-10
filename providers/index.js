const PROVIDERS = {
  anthropic: () => require('./anthropic'),
  openai: () => require('./openai'),
  gemini: () => require('./gemini'),
};

function getProvider() {
  const name = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(`Unknown AI_PROVIDER "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return factory();
}

module.exports = { getProvider };
