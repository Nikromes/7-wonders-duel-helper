// ================================
// SCAN FEATURE — Photo Recognition
// Зависимости: api-key.js, ai-config.js, scan-prompt.js, data.js, script.js
// ================================

function initScan() {
    const scanBtn = document.getElementById('scanBtn');
    const scanFileInput = document.getElementById('scanFileInput');
    const scanOverlay = document.getElementById('scanOverlay');
    const scanStatus = document.getElementById('scanStatus');
    const scanCancelBtn = document.getElementById('scanCancelBtn');
    const scanResultsOverlay = document.getElementById('scanResultsOverlay');
    const scanResultsBody = document.getElementById('scanResultsBody');
    const scanResultsCloseBtn = document.getElementById('scanResultsCloseBtn');

    let scanAbortController = null;

    scanBtn.addEventListener('click', () => {
        const apiKey = getApiKey();
        if (!apiKey) {
            showToast('⚠️ Введите API-ключ в настройках (⚙️)', 'error');
            return;
        }
        scanFileInput.click();
    });

    scanCancelBtn.addEventListener('click', () => {
        if (scanAbortController) {
            scanAbortController.abort();
            scanAbortController = null;
        }
        scanOverlay.classList.remove('active');
    });

    scanResultsCloseBtn.addEventListener('click', () => {
        scanResultsOverlay.classList.remove('active');
    });

    scanFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        scanFileInput.value = '';

        scanOverlay.classList.add('active');
        scanStatus.textContent = 'Подготовка фото...';

        try {
            const base64 = await fileToBase64(file);
            const mimeType = file.type || 'image/jpeg';

            scanStatus.textContent = 'Анализ карт через AI...';

            const deck = gameData.predictorDeck[currentAge];
            // Build detailed card data for AI: name | color | cost | effect
            const colorNames = { brown: 'коричневая', gray: 'серая', red: 'красная', blue: 'синяя', green: 'зелёная', yellow: 'жёлтая', purple: 'фиолетовая' };
            const cardData = deck.map(c => {
                const colorRu = colorNames[c.color] || c.color;
                const costStr = c.cost && c.cost.length > 0 ? c.cost.join(', ') : 'бесплатно';
                const effect = c.type || '';
                return `${c.title} | ${colorRu} | ${costStr} | ${effect}`;
            }).join('\n');
            const ageLabel = currentAge === '1' ? 'I' : currentAge === '2' ? 'II' : 'III';

            console.group('📷 Scan — данные для AI');
            console.log('Эпоха:', ageLabel);
            console.log('Карты:\n' + cardData);
            console.groupEnd();

            scanAbortController = new AbortController();
            const recognizedNames = await callGeminiVision(base64, mimeType, ageLabel, cardData, scanAbortController.signal);

            scanStatus.textContent = 'Сопоставление карт...';

            const matchedIds = matchCardsToIds(recognizedNames, deck);

            // Помечаем найденные карты как вышедшие (видны на столе = рассекречены)
            deck.forEach(c => removedCards.delete(c.id));
            deck.forEach(c => {
                if (matchedIds.has(c.id)) {
                    removedCards.add(c.id);
                }
            });

            renderPredictor();
            scanOverlay.classList.remove('active');

            // Формируем списки для резюме
            const foundCards = deck.filter(c => matchedIds.has(c.id));
            const hiddenCards = deck.filter(c => !matchedIds.has(c.id));

            // Логируем в консоль
            console.group(`📷 Результат сканирования — Эпоха ${ageLabel}`);
            console.log(`Найдено: ${foundCards.length} из ${deck.length}`);
            console.log('✅ Обнаружены:', foundCards.map(c => c.title));
            console.log('❓ Не обнаружены:', hiddenCards.map(c => c.title));
            console.log('Raw AI ответ:', recognizedNames);
            console.groupEnd();

            // Показываем модальное окно с резюме
            showScanResults(foundCards, hiddenCards, ageLabel);

        } catch (err) {
            scanOverlay.classList.remove('active');
            if (err.name === 'AbortError') {
                showToast('Сканирование отменено', 'error');
            } else {
                console.error('Scan error:', err);
                showToast('❌ Ошибка: ' + (err.message || 'Не удалось проанализировать фото'), 'error');
            }
        }
    });

    function showScanResults(foundCards, hiddenCards, ageLabel) {
        let html = `<div class="scan-results-summary">Эпоха ${ageLabel}: найдено ${foundCards.length} из ${foundCards.length + hiddenCards.length} карт</div>`;

        html += `<h4>✅ Обнаружены на столе (${foundCards.length})</h4>`;
        if (foundCards.length > 0) {
            html += '<ul>' + foundCards.map(c => `<li class="found">• ${c.title}</li>`).join('') + '</ul>';
        } else {
            html += '<p style="opacity:0.5; padding-left:8px;">—</p>';
        }

        html += `<h4>❓ Не обнаружены (${hiddenCards.length})</h4>`;
        if (hiddenCards.length > 0) {
            html += '<ul>' + hiddenCards.map(c => `<li class="hidden">• ${c.title}</li>`).join('') + '</ul>';
        } else {
            html += '<p style="opacity:0.5; padding-left:8px;">—</p>';
        }

        scanResultsBody.innerHTML = html;
        scanResultsOverlay.classList.add('active');
    }
}

// ---- Вспомогательные функции ----

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function callGeminiVision(base64Image, mimeType, ageLabel, cardData, signal) {
    // Собираем промпт из шаблона
    const prompt = SCAN_PROMPT_TEMPLATE
        .replace('{{AGE_LABEL}}', ageLabel)
        .replace('{{CARD_DATA}}', cardData);

    const endpoint = AI_CONFIG.getEndpoint();

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Image
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096
        }
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API ошибка: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Парсим JSON-массив из ответа (может быть обёрнут в markdown code block или обрезан)
    // Убираем markdown обёртку
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

    // Ищем массив (greedy чтобы захватить всё)
    let jsonMatch = cleaned.match(/\[[\s\S]*\]/);

    // Если нет закрывающей скобки — ответ обрезан, пробуем починить
    if (!jsonMatch) {
        const openBracket = cleaned.indexOf('[');
        if (openBracket !== -1) {
            // Обрезанный массив — добавляем закрывающую скобку
            let partial = cleaned.substring(openBracket).trimEnd();
            // Убираем последнюю незакрытую запятую/кавычку
            partial = partial.replace(/,\s*$/, '').replace(/,\s*"[^"]*$/, '');
            partial += ']';
            jsonMatch = [partial];
            console.warn('Ответ AI был обрезан, пытаемся восстановить...');
        }
    }

    if (!jsonMatch) {
        console.warn('Gemini raw response:', text);
        throw new Error('AI не вернул список карт. Попробуйте снова с более чётким фото.');
    }

    try {
        return JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
        console.warn('JSON parse failed for:', jsonMatch[0], parseErr);
        throw new Error('Не удалось разобрать ответ AI. Попробуйте снова.');
    }
}

function matchCardsToIds(recognizedNames, deck) {
    const matchedIds = new Set();

    recognizedNames.forEach(name => {
        const nameLower = name.toLowerCase().trim();

        // Точное совпадение
        let found = deck.find(c => c.title.toLowerCase() === nameLower);

        // Нечёткое: подстрока
        if (!found) {
            found = deck.find(c =>
                c.title.toLowerCase().includes(nameLower) ||
                nameLower.includes(c.title.toLowerCase())
            );
        }

        // Ещё нечётче: по первым N символам
        if (!found) {
            const prefix = nameLower.substring(0, Math.min(5, nameLower.length));
            found = deck.find(c => c.title.toLowerCase().startsWith(prefix));
        }

        if (found) {
            matchedIds.add(found.id);
        } else {
            console.warn(`Карта не найдена: "${name}"`);
        }
    });

    return matchedIds;
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.scan-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `scan-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ---- Настройки API-ключа ----

function initSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const settingsCloseBtn = document.getElementById('settingsCloseBtn');
    const settingsSaveBtn = document.getElementById('settingsSaveBtn');
    const settingsClearBtn = document.getElementById('settingsClearBtn');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const settingsStatus = document.getElementById('settingsStatus');

    function updateStatus() {
        const key = getApiKey();
        if (key) {
            const masked = key.slice(0, 6) + '•••' + key.slice(-4);
            settingsStatus.innerHTML = `<span style="color: #81c784;">✅ Ключ сохранён: ${masked}</span>`;
            apiKeyInput.value = key;
        } else {
            settingsStatus.innerHTML = `<span style="color: var(--text-muted);">Ключ не установлен</span>`;
            apiKeyInput.value = '';
        }
    }

    settingsBtn.addEventListener('click', () => {
        updateStatus();
        settingsOverlay.classList.add('active');
    });

    settingsCloseBtn.addEventListener('click', () => {
        settingsOverlay.classList.remove('active');
    });

    settingsSaveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            settingsStatus.innerHTML = `<span style="color: #ef5350;">Введите ключ</span>`;
            return;
        }
        setApiKey(key);
        updateStatus();
        showToast('✅ API-ключ сохранён', 'success');
    });

    settingsClearBtn.addEventListener('click', () => {
        setApiKey('');
        updateStatus();
        showToast('🗑️ API-ключ удалён', 'success');
    });
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    initScan();
    initSettings();
});
