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

// ---- X-Ray Зрение ----

function initXray() {
    const xrayBtn = document.getElementById('xrayBtn');
    const xrayOverlay = document.getElementById('xrayOverlay');
    const xrayVideo = document.getElementById('xrayVideo');
    const xrayCanvas = document.getElementById('xrayCanvas');
    const xrayStats = document.getElementById('xrayStats');
    const xrayCards = document.getElementById('xrayCards');
    const xrayCloseBtn = document.getElementById('xrayCloseBtn');
    const xrayCaptureBtn = document.getElementById('xrayCaptureBtn');
    const xrayReshuffleBtn = document.getElementById('xrayReshuffleBtn');

    let xrayStream = null;
    let detectedPositions = []; // [{x: %, y: %}, ...] from AI
    let hiddenCards = [];       // cards not in removedCards

    const colorMap = {
        brown: '#8d6e4a', gray: '#9e9e9e', red: '#e53935',
        blue: '#42a5f5', green: '#66bb6a', yellow: '#fdd835', purple: '#ab47bc'
    };

    function getHiddenCards() {
        let deck = [...gameData.predictorDeck[currentAge]];
        if (currentAge === '3') {
            const guildCards = gameData.guilds.map((g, i) => ({
                id: `a3_guild_${i}`, title: g.title, type: g.desc,
                color: g.color, cost: g.cost, dlc: g.dlc
            }));
            deck = [...deck, ...guildCards];
        }
        return deck.filter(c => !removedCards.has(c.id));
    }

    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function renderOverlayCards() {
        const ageLabel = currentAge === '1' ? 'I' : currentAge === '2' ? 'II' : 'III';
        const total = hiddenCards.length;
        const spotsOnTable = detectedPositions.length;
        const inBox = Math.max(0, total - spotsOnTable);

        xrayStats.innerHTML = `
            <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
            <div class="xray-stats-line">Скрыто: ${total} карт · На столе: ${spotsOnTable} · В коробке: ~${inBox}</div>
            <div class="xray-stats-sub">Нажмите 🔀 для перераспределения предсказаний</div>
        `;

        // Randomly pick cards for each detected position
        const shuffled = shuffle(hiddenCards);
        const assigned = shuffled.slice(0, spotsOnTable);

        xrayCards.innerHTML = assigned.map((card, i) => {
            const pos = detectedPositions[i];
            const bg = colorMap[card.color] || '#555';
            const costStr = card.cost && card.cost.length > 0 ? card.cost.join(', ') : 'бесплатно';
            return `
                <div class="xray-card" style="left: ${pos.x}%; top: ${pos.y}%;">
                    <div class="xray-card-color" style="background: ${bg};"></div>
                    <div class="xray-card-title">${card.title}</div>
                    <div class="xray-card-info">${card.type || ''}</div>
                    <div class="xray-card-info">${costStr}</div>
                </div>
            `;
        }).join('');
    }

    function captureFrame() {
        const ctx = xrayCanvas.getContext('2d');
        xrayCanvas.width = xrayVideo.videoWidth;
        xrayCanvas.height = xrayVideo.videoHeight;
        ctx.drawImage(xrayVideo, 0, 0);
        return xrayCanvas.toDataURL('image/jpeg', 0.8);
    }

    async function detectFaceDownPositions(base64DataUrl) {
        const apiKey = getApiKey();
        if (!apiKey) {
            showToast('⚠️ Введите API-ключ в настройках (⚙️)', 'error');
            return null;
        }

        const base64 = base64DataUrl.split(',')[1];
        const prompt = `На этом фото — игровой стол "7 Wonders Duel". На столе карты в пирамидальной раскладке.

Найди ВСЕ карты, которые лежат РУБАШКОЙ ВВЕРХ (закрытые, face-down). Это карты с тёмной однотонной задней стороной без рисунка, обычно коричневого/бежевого цвета с узором.

НЕ ВКЛЮЧАЙ карты лежащие лицом вверх (с видимым рисунком, названием, иконками).

Для каждой найденной закрытой карты верни её ЦЕНТР в процентах от ширины и высоты изображения.

Ответь ТОЛЬКО в формате JSON-массива объектов, без пояснений:
[{"x": 50, "y": 30}, {"x": 25, "y": 60}]

Где x — процент от левого края (0-100), y — процент от верхнего края (0-100).`;

        const endpoint = AI_CONFIG.getEndpoint();
        const body = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: 'image/jpeg', data: base64 } }
                ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log('X-Ray AI response:', text);

        // Parse JSON from response
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) return [];

        try {
            const positions = JSON.parse(match[0]);
            return positions.filter(p => typeof p.x === 'number' && typeof p.y === 'number');
        } catch {
            console.error('Failed to parse X-Ray positions:', cleaned);
            return [];
        }
    }

    async function startCamera() {
        try {
            xrayStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            xrayVideo.srcObject = xrayStream;
        } catch (err) {
            console.error('Camera error:', err);
            showToast('⚠️ Не удалось включить камеру', 'error');
            closeXray();
        }
    }

    function stopCamera() {
        if (xrayStream) {
            xrayStream.getTracks().forEach(t => t.stop());
            xrayStream = null;
        }
        xrayVideo.srcObject = null;
    }

    function openXray() {
        hiddenCards = getHiddenCards();
        detectedPositions = [];
        xrayCards.innerHTML = '';
        xrayCanvas.classList.remove('active');
        xrayCaptureBtn.style.display = '';
        xrayCaptureBtn.textContent = '📸 Сканировать';
        xrayReshuffleBtn.style.display = 'none';

        const ageLabel = currentAge === '1' ? 'I' : currentAge === '2' ? 'II' : 'III';
        xrayStats.innerHTML = `
            <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
            <div class="xray-stats-line">Скрытых карт: ${hiddenCards.length}</div>
            <div class="xray-stats-sub">Наведите камеру на стол и нажмите 📸</div>
        `;

        xrayOverlay.classList.add('active');
        startCamera();
    }

    function closeXray() {
        stopCamera();
        xrayOverlay.classList.remove('active');
        xrayCards.innerHTML = '';
        xrayCanvas.classList.remove('active');
    }

    async function onCapture() {
        // Check video is ready
        if (!xrayVideo.videoWidth || !xrayVideo.videoHeight) {
            xrayStats.innerHTML = `
                <div class="xray-stats-line" style="color:#ef5350;">❌ Камера ещё не готова</div>
                <div class="xray-stats-sub">Подождите пока появится изображение и попробуйте снова</div>
            `;
            return;
        }

        // Check API key
        const apiKey = getApiKey();
        if (!apiKey) {
            xrayStats.innerHTML = `
                <div class="xray-stats-line" style="color:#ef5350;">❌ API-ключ не установлен</div>
                <div class="xray-stats-sub">Закройте X-Ray → нажмите ⚙️ → введите ключ</div>
            `;
            return;
        }

        xrayCaptureBtn.textContent = '⏳ Анализ...';
        xrayCaptureBtn.disabled = true;

        try {
            const frameDataUrl = captureFrame();
            console.log('X-Ray: frame captured, size:', frameDataUrl.length, 'video:', xrayVideo.videoWidth, 'x', xrayVideo.videoHeight);

            // Freeze: show canvas, hide video
            xrayCanvas.classList.add('active');
            xrayVideo.style.display = 'none';
            stopCamera();

            xrayStats.innerHTML = `
                <div class="xray-stats-line">⏳ Анализ изображения...</div>
                <div class="xray-stats-sub">Ищу закрытые карты на фото</div>
            `;

            const positions = await detectFaceDownPositions(frameDataUrl);

            if (!positions || positions.length === 0) {
                xrayStats.innerHTML = `
                    <div class="xray-stats-line" style="color:#ef5350;">❌ Закрытые карты не обнаружены</div>
                    <div class="xray-stats-sub">Попробуйте другой ракурс или более яркое освещение</div>
                `;
                // Unfreeze
                xrayCanvas.classList.remove('active');
                xrayVideo.style.display = '';
                startCamera();
                xrayCaptureBtn.textContent = '📸 Сканировать';
                xrayCaptureBtn.disabled = false;
                return;
            }

            detectedPositions = positions;
            console.log(`X-Ray: найдено ${positions.length} закрытых карт`, positions);

            renderOverlayCards();

            xrayCaptureBtn.style.display = 'none';
            xrayReshuffleBtn.style.display = '';
        } catch (err) {
            console.error('X-Ray error:', err);
            xrayStats.innerHTML = `
                <div class="xray-stats-line" style="color:#ef5350;">❌ Ошибка: ${err.message}</div>
                <div class="xray-stats-sub">Проверьте API-ключ и подключение к интернету</div>
            `;
            xrayCanvas.classList.remove('active');
            xrayVideo.style.display = '';
            startCamera();
        }

        xrayCaptureBtn.textContent = '📸 Сканировать';
        xrayCaptureBtn.disabled = false;
    }

    xrayBtn.addEventListener('click', openXray);
    xrayCloseBtn.addEventListener('click', closeXray);
    xrayCaptureBtn.addEventListener('click', onCapture);
    xrayReshuffleBtn.addEventListener('click', () => {
        renderOverlayCards(); // Re-shuffles cards on same positions, no API call
        showToast('🔀 Перемешано!', 'success');
    });
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    initScan();
    initSettings();
    initXray();
});
