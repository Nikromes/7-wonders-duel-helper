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
    const settingsBtns = document.querySelectorAll('.settings-toolbar-btn');
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

    settingsBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            updateStatus();
            settingsOverlay.classList.add('active');
        });
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

    // Manual X-Ray UI Elements
    const xrayPreActions = document.getElementById('xrayPreActions');
    const xrayBtnAi = document.getElementById('xrayBtnAi');
    const xrayBtnManual = document.getElementById('xrayBtnManual');
    const xrayPreCancelBtn = document.getElementById('xrayPreCancelBtn');
    const xrayWireframeContainer = document.getElementById('xrayWireframeContainer');
    const xrayWireframe = document.getElementById('xrayWireframe');
    const xrayManualControls = document.getElementById('xrayManualControls');
    const xrayScaleSlider = document.getElementById('xrayScaleSlider');
    const xrayConfirmBtn = document.getElementById('xrayConfirmBtn');

    let xrayStream = null;
    let detectedPositions = []; // [{x: %, y: %}, ...] from AI or Manual
    let hiddenCards = [];       // cards not in removedCards
    let pendingFrameDataUrl = null; // Stores captured image for passing to AI mode
    let manualScale = 1.0;
    let manualOffset = { x: 0, y: 0 };
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    const colorMap = {
        brown: '#8d6e4a', gray: '#9e9e9e', red: '#e53935',
        blue: '#42a5f5', green: '#66bb6a', yellow: '#fdd835', purple: '#ab47bc'
    };

    // Card dimensions ratio in wireframe (approx 7 Wonders Duel card ratio)
    const cardW = 44;
    const cardH = 68;
    const gapX = 10;
    const gapY = 24;

    // Layout Definitions. Coordinates in logical units (card widths/heights and gaps) relative to grid center (0,0).
    // 'fd': true = face-down (closed card), false = face-up (open card)
    const gridLayouts = {
        '1': [
            { row: -2, col: -0.5, fd: false }, { row: -2, col: 0.5, fd: false },
            { row: -1, col: -1, fd: true }, { row: -1, col: 0, fd: true }, { row: -1, col: 1, fd: true },
            { row: 0, col: -1.5, fd: false }, { row: 0, col: -0.5, fd: false }, { row: 0, col: 0.5, fd: false }, { row: 0, col: 1.5, fd: false },
            { row: 1, col: -2, fd: true }, { row: 1, col: -1, fd: true }, { row: 1, col: 0, fd: true }, { row: 1, col: 1, fd: true }, { row: 1, col: 2, fd: true },
            { row: 2, col: -2.5, fd: false }, { row: 2, col: -1.5, fd: false }, { row: 2, col: -0.5, fd: false }, { row: 2, col: 0.5, fd: false }, { row: 2, col: 1.5, fd: false }, { row: 2, col: 2.5, fd: false }
        ],
        '2': [
            { row: -2, col: -2.5, fd: false }, { row: -2, col: -1.5, fd: false }, { row: -2, col: -0.5, fd: false }, { row: -2, col: 0.5, fd: false }, { row: -2, col: 1.5, fd: false }, { row: -2, col: 2.5, fd: false },
            { row: -1, col: -2, fd: true }, { row: -1, col: -1, fd: true }, { row: -1, col: 0, fd: true }, { row: -1, col: 1, fd: true }, { row: -1, col: 2, fd: true },
            { row: 0, col: -1.5, fd: false }, { row: 0, col: -0.5, fd: false }, { row: 0, col: 0.5, fd: false }, { row: 0, col: 1.5, fd: false },
            { row: 1, col: -1, fd: true }, { row: 1, col: 0, fd: true }, { row: 1, col: 1, fd: true },
            { row: 2, col: -0.5, fd: false }, { row: 2, col: 0.5, fd: false }
        ],
        '3': [
            { row: -3, col: -0.5, fd: false }, { row: -3, col: 0.5, fd: false },
            { row: -2, col: -1, fd: true }, { row: -2, col: 0, fd: true }, { row: -2, col: 1, fd: true },
            { row: -1, col: -1.5, fd: false }, { row: -1, col: -0.5, fd: false }, { row: -1, col: 0.5, fd: false }, { row: -1, col: 1.5, fd: false },
            { row: 0, col: -1, fd: true }, { row: 0, col: 0, fd: false }, { row: 0, col: 1, fd: true },
            { row: 1, col: -1.5, fd: false }, { row: 1, col: -0.5, fd: false }, { row: 1, col: 0.5, fd: false }, { row: 1, col: 1.5, fd: false },
            { row: 2, col: -1, fd: true }, { row: 2, col: 0, fd: true }, { row: 2, col: 1, fd: true },
            { row: 3, col: -0.5, fd: false }, { row: 3, col: 0.5, fd: false }
        ]
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
        const unassigned = shuffled.slice(spotsOnTable);

        xrayCards.innerHTML = assigned.map((card, i) => {
            const pos = detectedPositions[i];
            const imgSrc = loadedCardFaces.get(card.id) || `assets/cards/faces/${card.id}.jpg`;

            // Если pos.w существует (снято в ручном режиме), применяем ширину
            const widthStyle = pos.w ? `width: ${pos.w}%;` : '';
            const scanDelay = (i * 0.07).toFixed(2);

            return `
                <div class="xray-card scanning" style="left: ${pos.x}%; top: ${pos.y}%; ${widthStyle} animation-delay: ${scanDelay}s;">
                    <img class="xray-card-img" src="${imgSrc}" alt="${card.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                    <div class="xray-card-fallback" style="display:none;">
                        <div class="xray-card-title">${card.title}</div>
                        <div class="xray-card-info">${card.type || ''}</div>
                    </div>
                </div>
            `;
        }).join('');

        // After scan animation completes, switch to normal pulse/float
        const scanDuration = assigned.length * 70 + 700;
        setTimeout(() => {
            xrayCards.querySelectorAll('.xray-card.scanning').forEach(el => {
                el.classList.remove('scanning');
                el.style.animationDelay = '';
            });
        }, scanDuration);

        // Render deck panel with unassigned cards
        const xrayDeckPanel = document.getElementById('xrayDeckPanel');
        const xrayDeckCards = document.getElementById('xrayDeckCards');

        if (unassigned.length > 0) {
            xrayDeckCards.innerHTML = unassigned.map(card => {
                const imgSrc = loadedCardFaces.get(card.id) || `assets/cards/faces/${card.id}.jpg`;
                return `
                    <div class="xray-deck-card" title="${card.title}">
                        <img class="xray-deck-card-img" src="${imgSrc}" alt="${card.title}"
                             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                        <div class="xray-deck-card-fallback" style="display:none;">
                            <span>${card.title}</span>
                        </div>
                        <div class="xray-deck-card-name">${card.title}</div>
                    </div>
                `;
            }).join('');
            xrayDeckPanel.style.display = 'flex';
        } else {
            xrayDeckPanel.style.display = 'none';
        }
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
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('X-Ray API error:', response.status, errBody);
            throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        console.log('X-Ray AI full response:', JSON.stringify(data).slice(0, 500));
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log('X-Ray AI text:', text);

        if (!text) {
            console.error('X-Ray: empty text in response, full data:', data);
            return [];
        }

        // Parse JSON from response
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) {
            console.error('X-Ray: no JSON array found in:', cleaned);
            return [];
        }

        try {
            const positions = JSON.parse(match[0]);
            return positions.filter(p => typeof p.x === 'number' && typeof p.y === 'number');
        } catch (e) {
            console.error('X-Ray: JSON parse error:', e.message, 'in:', cleaned);
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

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Hidden file input for desktop mode
    const xrayFileInput = document.createElement('input');
    xrayFileInput.type = 'file';
    xrayFileInput.accept = 'image/*';
    xrayFileInput.style.display = 'none';
    document.body.appendChild(xrayFileInput);

    function openXray() {
        hiddenCards = getHiddenCards();
        detectedPositions = [];
        xrayCards.innerHTML = '';
        xrayCanvas.classList.remove('active');
        xrayCaptureBtn.style.display = '';
        xrayReshuffleBtn.style.display = 'none';

        const ageLabel = currentAge === '1' ? 'I' : currentAge === '2' ? 'II' : 'III';

        if (isMobile) {
            xrayCaptureBtn.textContent = '📸 Сканировать';
            xrayStats.innerHTML = `
                <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
                <div class="xray-stats-line">Скрытых карт: ${hiddenCards.length}</div>
                <div class="xray-stats-sub">Наведите камеру на стол и нажмите 📸</div>
            `;
            xrayVideo.style.display = '';
            xrayOverlay.classList.add('active');
            startCamera();
        } else {
            xrayCaptureBtn.textContent = '📁 Выбрать фото';
            xrayStats.innerHTML = `
                <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
                <div class="xray-stats-line">Скрытых карт: ${hiddenCards.length}</div>
                <div class="xray-stats-sub">Выберите фото раскладки на столе</div>
            `;
            xrayVideo.style.display = 'none';
            xrayOverlay.classList.add('active');
        }
    }

    function closeXray() {
        stopCamera();
        xrayOverlay.classList.remove('active');
        xrayCards.innerHTML = '';
        xrayCanvas.classList.remove('active');
        xrayVideo.style.display = '';
    }

    function renderManualWireframe() {
        const layout = gridLayouts[currentAge] || [];
        xrayWireframe.innerHTML = layout.map(card => {
            const left = card.col * (cardW + gapX);
            const top = card.row * (cardH + gapY * 0.5); // overlapping rows
            const classes = `wireframe-card ${card.fd ? 'wireframe-fd' : ''}`;
            // Store relative logical position in data attributes for extraction later
            return `<div class="${classes}" style="width:${cardW}px; height:${cardH}px; left:${left}px; top:${top}px;" data-fd="${card.fd}"></div>`;
        }).join('');
    }

    function startManualXray() {
        xrayStats.innerHTML = `
            <div class="xray-stats-line">📐 Совместите сетку с фото</div>
            <div class="xray-stats-sub">Двигайте сетку пальцем. Внизу можно менять масштаб.</div>
        `;

        xrayWireframeContainer.style.display = 'flex';
        xrayManualControls.style.display = 'flex';

        // Reset scale and offset
        manualScale = 1.0;
        xrayScaleSlider.value = 100;
        manualOffset = { x: 0, y: 0 };
        updateWireframeTransform();
        renderManualWireframe();

        // Optional logic: if the user hasn't selected anything for AI before...
        // We'll rely on confirm to populate detectedPositions.
    }

    // --- Drag and Scale Logic ---
    function updateWireframeTransform() {
        xrayWireframe.style.transform = `translate(${manualOffset.x}px, ${manualOffset.y}px) scale(${manualScale})`;
    }

    xrayScaleSlider.addEventListener('input', (e) => {
        manualScale = parseInt(e.target.value, 10) / 100;
        updateWireframeTransform();
    });

    // Touch/Mouse events on container
    function handleDragStart(e) {
        if (xrayWireframeContainer.style.display === 'none') return;
        if (e.target.closest('.xray-controls') || e.target.closest('.xray-manual-controls')) return;
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        dragStart = { x: clientX - manualOffset.x, y: clientY - manualOffset.y };
    }

    function handleDragMove(e) {
        if (!isDragging) return;
        e.preventDefault(); // prevent scrolling
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        manualOffset.x = clientX - dragStart.x;
        manualOffset.y = clientY - dragStart.y;
        updateWireframeTransform();
    }

    function handleDragEnd() {
        isDragging = false;
    }

    xrayOverlay.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    xrayOverlay.addEventListener('touchstart', handleDragStart, { passive: false });
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);

    // --- Confirm Manual Layout ---
    xrayConfirmBtn.addEventListener('click', () => {
        // Calculate logic logical percentages BEFORE hiding UI
        const canvasRect = xrayCanvas.getBoundingClientRect();
        const fdcards = xrayWireframe.querySelectorAll('.wireframe-fd');
        const positions = [];

        fdcards.forEach((cardEl) => {
            const rect = cardEl.getBoundingClientRect();
            // Calculate absolute visual center of the card
            const centerX = rect.left + rect.width / 2 - canvasRect.left;
            const centerY = rect.top + rect.height / 2 - canvasRect.top;

            const posX = (centerX / canvasRect.width) * 100;
            const posY = (centerY / canvasRect.height) * 100;

            // Высчитываем ширину карточки в процентах относительно экрана
            const posW = (rect.width / canvasRect.width) * 100;

            positions.push({ x: posX, y: posY, w: posW });
        });

        // Add small random noise to positions to avoid stacking if overlapping
        detectedPositions = positions.map(p => ({
            x: Math.max(0, Math.min(100, p.x)),
            y: Math.max(0, Math.min(100, p.y)),
            w: p.w
        }));

        xrayWireframeContainer.style.display = 'none';
        xrayManualControls.style.display = 'none';

        xrayStats.innerHTML = `
            <div class="xray-stats-line">✅ Позиции подтверждены</div>
            <div class="xray-stats-sub">Раскладываю предсказания...</div>
        `;

        console.log(`X-Ray (Manual): confirmed ${detectedPositions.length} face-down cards`);

        renderOverlayCards();
        xrayReshuffleBtn.style.display = '';
    });

    closeXray = function closeXrayLocal() {
        stopCamera();
        xrayOverlay.classList.remove('active');
        xrayCards.innerHTML = '';
        xrayCanvas.classList.remove('active');
        xrayVideo.style.display = '';
        xrayWireframeContainer.style.display = 'none';
        xrayManualControls.style.display = 'none';
        xrayPreActions.style.display = 'none';
        document.getElementById('xrayDeckPanel').style.display = 'none';
    };

    // Deck panel collapse/expand toggle
    const xrayDeckToggle = document.getElementById('xrayDeckToggle');
    const xrayDeckPanel = document.getElementById('xrayDeckPanel');
    let deckExpanded = true;
    xrayDeckToggle.addEventListener('click', () => {
        deckExpanded = !deckExpanded;
        const xrayDeckCards = document.getElementById('xrayDeckCards');
        xrayDeckCards.style.display = deckExpanded ? '' : 'none';
        xrayDeckToggle.textContent = deckExpanded ? '▲' : '▼';
    });

    // Shared analysis function — takes dataUrl, detects positions, renders cards
    async function analyzeFrame(frameDataUrl) {
        xrayCaptureBtn.textContent = '⏳ Анализ...';
        xrayCaptureBtn.disabled = true;

        // Check API key first for AI mode
        const apiKey = getApiKey();
        if (!apiKey) {
            xrayStats.innerHTML = `
                <div class="xray-stats-line" style="color:#ef5350;">❌ API-ключ не установлен</div>
                <div class="xray-stats-sub">Полный X-Ray доступен только с API-ключом Gemini</div>
            `;
            xrayCaptureBtn.textContent = isMobile ? '📸 Сделать фото' : '📁 Выбрать фото';
            xrayCaptureBtn.disabled = false;
            return;
        }

        try {
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
                xrayCanvas.classList.remove('active');
                if (isMobile) {
                    xrayVideo.style.display = '';
                    startCamera();
                }
                xrayCaptureBtn.textContent = isMobile ? '📸 Сделать фото' : '📁 Выбрать фото';
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
            if (isMobile) {
                xrayVideo.style.display = '';
                startCamera();
            }
        }

        xrayCaptureBtn.textContent = isMobile ? '📸 Сделать фото' : '📁 Выбрать фото';
        xrayCaptureBtn.disabled = false;
    }

    function showPreActions(dataUrl) {
        pendingFrameDataUrl = dataUrl;
        xrayCaptureBtn.style.display = 'none';

        // Draw image initially as background
        xrayCanvas.classList.add('active');
        xrayVideo.style.display = 'none';
        stopCamera();

        const img = new Image();
        img.onload = () => {
            xrayCanvas.width = img.width;
            xrayCanvas.height = img.height;
            const ctx = xrayCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;

        xrayStats.innerHTML = `
            <div class="xray-stats-line">📸 Фото получено</div>
            <div class="xray-stats-sub">Выберите способ поиска закрытых карт</div>
        `;

        xrayPreActions.style.display = 'flex';
    }

    xrayBtnAi.addEventListener('click', async () => {
        xrayPreActions.style.display = 'none';
        if (pendingFrameDataUrl) {
            await analyzeFrame(pendingFrameDataUrl);
        }
    });

    xrayBtnManual.addEventListener('click', () => {
        xrayPreActions.style.display = 'none';
        if (pendingFrameDataUrl) {
            startManualXray();
        }
    });

    xrayPreCancelBtn.addEventListener('click', () => {
        xrayPreActions.style.display = 'none';
        pendingFrameDataUrl = null;
        xrayCanvas.classList.remove('active');

        xrayCaptureBtn.style.display = '';
        xrayCaptureBtn.textContent = isMobile ? '📸 Сканировать' : '📁 Выбрать фото';

        const ageLabel = currentAge === '1' ? 'I' : currentAge === '2' ? 'II' : 'III';

        if (isMobile) {
            xrayStats.innerHTML = `
                <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
                <div class="xray-stats-line">Скрытых карт: ${hiddenCards.length}</div>
                <div class="xray-stats-sub">Наведите камеру на стол и нажмите 📸</div>
            `;
            xrayVideo.style.display = '';
            startCamera();
        } else {
            xrayStats.innerHTML = `
                <div class="xray-stats-line">🔮 X-Ray · Эпоха ${ageLabel}</div>
                <div class="xray-stats-line">Скрытых карт: ${hiddenCards.length}</div>
                <div class="xray-stats-sub">Выберите фото раскладки на столе</div>
            `;
            xrayVideo.style.display = 'none';
        }
    });

    async function onCapture() {
        // Check API key first if we want strict enforcement, but for manual mode it's not strictly necessary.
        // We defer API check to AI analysis mode start.

        if (isMobile) {
            // Mobile: capture from camera
            if (!xrayVideo.videoWidth || !xrayVideo.videoHeight) {
                xrayStats.innerHTML = `
                    <div class="xray-stats-line" style="color:#ef5350;">❌ Камера ещё не готова</div>
                    <div class="xray-stats-sub">Подождите пока появится изображение и попробуйте снова</div>
                `;
                return;
            }
            const frameDataUrl = captureFrame();
            console.log('X-Ray: frame captured, size:', frameDataUrl.length, 'video:', xrayVideo.videoWidth, 'x', xrayVideo.videoHeight);
            showPreActions(frameDataUrl);
        } else {
            // Desktop: open file picker
            xrayFileInput.click();
        }
    }

    // Handle file selection on desktop
    xrayFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        xrayFileInput.value = '';

        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            showPreActions(dataUrl);
        };
        reader.readAsDataURL(file);
    });

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
