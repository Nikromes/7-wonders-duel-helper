// Google Gemini API Configuration
// API ключ загружается из api-key.js (добавлен в .gitignore)
const AI_CONFIG = {
    model: 'gemini-3-flash-preview',
    getEndpoint() {
        return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${getApiKey()}`;
    }
};
