// API Key Management
// Приоритет: localStorage > значение ниже
// Получить бесплатный ключ: https://aistudio.google.com/apikey

const GEMINI_API_KEY_FALLBACK = ''; // Фолбэк (для локальной разработки)

function getApiKey() {
    return localStorage.getItem('gemini_api_key') || GEMINI_API_KEY_FALLBACK;
}

function setApiKey(key) {
    if (key) {
        localStorage.setItem('gemini_api_key', key.trim());
    } else {
        localStorage.removeItem('gemini_api_key');
    }
}

// Глобальная переменная для обратной совместимости
const GEMINI_API_KEY = getApiKey();
