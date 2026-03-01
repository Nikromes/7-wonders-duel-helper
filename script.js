// State
let currentView = 'wiki';
let currentTab = 'tokens';
let searchQuery = '';
let currentAge = '1';
const removedCards = new Set();

// DOM Elements
const navBtns = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view-section');
const tabs = document.querySelectorAll('#wikiView .tab');
const ageTabs = document.querySelectorAll('.age-tabs .tab');
const searchInput = document.getElementById('searchInput');
const itemsContainer = document.getElementById('itemsContainer');
const predictorList = document.getElementById('predictorList');
const cardsLeftEl = document.getElementById('cardsLeft');
const cardsRemovedEl = document.getElementById('cardsRemoved');

// Helper to parse cost arrays into HTML images
function getCostHtml(costArray) {
    if (!costArray || costArray.length === 0) return '';

    // Mapping Russian resource names to asset filenames
    const resourceMap = {
        'дерева': 'wood.png', 'дерево': 'wood.png', 'дерево x2': 'wood.png',
        'глины': 'clay.png', 'глина': 'clay.png', 'глина x2': 'clay.png',
        'камня': 'stone.png', 'камень': 'stone.png', 'камень x2': 'stone.png',
        'стекла': 'glass.png', 'стекло': 'glass.png',
        'папирус': 'papyrus.png',
        'монеты': 'coin.png', 'монета': 'coin.png',
        'оружия': 'shield.png', 'щит': 'shield.png'
    };

    let html = '<div class="cost-icons">';

    costArray.forEach(costStr => {
        const parts = costStr.trim().split(' ');
        let count = 1;
        let resName = costStr.toLowerCase();

        if (parts.length > 1 && !isNaN(parseInt(parts[0]))) {
            count = parseInt(parts[0]);
            resName = parts.slice(1).join(' ').toLowerCase();
        }

        const filename = resourceMap[resName] || 'unknown.png';

        if (resName === 'монета' || resName === 'монеты') {
            html += `
                <div class="coin-icon-container" title="${count} Монет">
                    <img src="assets/icons/${filename}" class="res-icon" alt="${resName}" onerror="this.outerHTML='<span class=\\'res-text\\'>${count} ${resName}</span>'">
                    <span class="coin-amount">${count}</span>
                </div>`;
        } else {
            for (let i = 0; i < count; i++) {
                html += `<img src="assets/icons/${filename}" class="res-icon" alt="${resName}" title="${resName}" onerror="this.outerHTML='<span class=\\'res-text\\'>${resName}</span>'">`;
            }
        }
    });

    html += '</div>';
    return html;
}

// Helper to parse simple effects into HTML images
function getEffectHtml(effectStr) {
    if (!effectStr) return '';

    const s = effectStr.toLowerCase().trim();

    // Basic Exact Matches
    const resMap = {
        'дерево': { file: 'wood.png', count: 1 },
        'глина': { file: 'clay.png', count: 1 },
        'камень': { file: 'stone.png', count: 1 },
        'стекло': { file: 'glass.png', count: 1 },
        'папирус': { file: 'papyrus.png', count: 1 },
        'дерево x2': { file: 'wood.png', count: 2 },
        'глина x2': { file: 'clay.png', count: 2 },
        'камень x2': { file: 'stone.png', count: 2 }
    };

    if (resMap[s]) {
        let { file, count } = resMap[s];
        let html = '<div class="effect-icons-container">';
        for (let i = 0; i < count; i++) {
            html += `<img src="assets/icons/${file}" class="res-icon effect-icon" alt="${s}">`;
        }
        html += '</div>';
        return html;
    }

    // Number-prefixed simple matches
    const numMatch = s.match(/^(\d+)\s*(щит|щита|щитов|по|монет|монеты|монета)$/);
    if (numMatch) {
        let count = parseInt(numMatch[1]);
        let type = numMatch[2];

        let html = '<div class="effect-icons-container">';
        if (type.startsWith('щит')) {
            for (let i = 0; i < count; i++) {
                html += `<img src="assets/icons/shield.png" class="res-icon effect-icon" alt="щит">`;
            }
        } else if (type === 'по') {
            html += `<div class="vp-icon-container" title="${count} ПО"><span class="vp-amount">${count}</span></div>`;
        } else if (type.startsWith('монет')) {
            html += `<div class="coin-icon-container" title="${count} Монет"><img src="assets/icons/coin.png" class="res-icon effect-icon" alt="монеты"><span class="coin-amount">${count}</span></div>`;
        }
        html += '</div>';
        return html;
    }

    // Fallback
    return `<div class="effect-desc">${effectStr}</div>`;
}

// Init
function init() {
    setupEventListeners();
    renderItems();
    renderPredictor();
}

function setupEventListeners() {
    // Navigation routing
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;

            navBtns.forEach(b => {
                if (b.dataset.view === viewId) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });

            views.forEach(v => {
                if (v.id === viewId + 'View') {
                    v.classList.add('active');
                } else {
                    v.classList.remove('active');
                }
            });
            window.scrollTo({ top: 0, behavior: 'instant' });
        });
    });

    // Wiki Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            renderItems();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Age Tabs for Predictor
    ageTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ageTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentAge = tab.dataset.age;
            renderPredictor();
        });
    });

    // Search
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderItems();
    });
}

function renderItems() {
    itemsContainer.innerHTML = '';

    let itemsToRender = [];

    if (searchQuery.length > 0) {
        ['tokens', 'wonders', 'guilds'].forEach(category => {
            const matched = gameData[category].filter(item =>
                item.title.toLowerCase().includes(searchQuery) ||
                (item.desc && item.desc.toLowerCase().includes(searchQuery)) ||
                (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchQuery)))
            ).map(item => ({ ...item, category }));
            itemsToRender = [...itemsToRender, ...matched];
        });

        Object.keys(gameData.predictorDeck).forEach(age => {
            const matched = gameData.predictorDeck[age].filter(item =>
                item.title.toLowerCase().includes(searchQuery) ||
                (item.type && item.type.toLowerCase().includes(searchQuery))
            ).map(item => ({
                ...item,
                category: `age${age}`,
                desc: `${item.type}`,
                tags: item.cost ? item.cost : []
            }));
            itemsToRender = [...itemsToRender, ...matched];
        });

    } else {
        itemsToRender = gameData[currentTab].map(item => ({ ...item, category: currentTab }));
    }

    // Sort: base game first, then DLC grouped by name, alphabetical within each group
    itemsToRender.sort((a, b) => {
        const aDlc = a.dlc || '';
        const bDlc = b.dlc || '';
        if (aDlc !== bDlc) {
            if (!aDlc) return -1;
            if (!bDlc) return 1;
            return aDlc.localeCompare(bDlc);
        }
        return a.title.localeCompare(b.title, 'ru');
    });

    if (itemsToRender.length === 0) {
        itemsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏛️</div>
                <h3>Ничего не найдено</h3>
                <p>Попробуйте изменить запрос</p>
            </div>
        `;
        return;
    }

    const categoryNames = {
        tokens: 'Жетон развития',
        wonders: 'Чудо света',
        guilds: 'Гильдия',
        age1: 'I Эпоха',
        age2: 'II Эпоха',
        age3: 'III Эпоха'
    };

    itemsToRender.forEach((item, index) => {
        const card = document.createElement('div');
        const colorClass = item.color ? `card-color-${item.color}` : 'card-color-wonder';
        card.className = `item-card ${colorClass}`;

        const hasCost = item.cost && item.cost.length > 0;
        const costHtml = hasCost ? `<div class="card-info-badge cost-badge">${getCostHtml(item.cost)}</div>` : '';
        const chainReqHtml = item.chainReq ? `<div class="card-info-badge chain-badge" title="Строится бесплатно при цепочке: ${item.chainReq}">🔗 ${item.chainReq}</div>` : '';
        const chainGivesHtml = item.chainGiv ? `<div class="card-info-badge chain-gives-indicator" title="Даёт символ: ${item.chainGiv}">⛓ ${item.chainGiv}</div>` : '';

        const hasInfoRow = hasCost || item.chainReq || item.chainGiv;

        const categoryLabel = searchQuery.length > 0 ?
            `<div class="item-category-label">${categoryNames[item.category] || item.category}</div>` : '';

        let bgImage = 'wonder.png';
        if (item.category === 'guilds') bgImage = 'guild.png';
        else if (item.age) bgImage = `${item.age}-epoch.png`;
        else if (item.category === 'tokens') bgImage = '';

        let styleStr = `animation-delay: ${index * 0.05}s`;
        if (bgImage) styleStr += `; background-image: url('assets/cards/${bgImage}')`;
        card.setAttribute('style', styleStr);

        const dlcBadge = item.dlc ? `<div class="dlc-badge dlc-${item.dlc.toLowerCase()}">${item.dlc}</div>` : '';

        card.innerHTML = `
            <div class="card-top-bar">
                ${getEffectHtml(item.desc || item.type || '')}
            </div>
            ${hasInfoRow ? `<div class="card-info-row">${costHtml}${chainReqHtml}${chainGivesHtml}</div>` : ''}
            ${categoryLabel}
            <div class="card-bottom-strip">
                <div class="card-title">${item.title}</div>
                ${dlcBadge}
            </div>
        `;

        itemsContainer.appendChild(card);
    });
}

function renderPredictor() {
    const predictorList = document.getElementById('predictorList');
    const removedList = document.getElementById('removedList');
    const removedHeader = document.getElementById('removedHeader');
    const removedListCount = document.getElementById('removedListCount');

    predictorList.innerHTML = '';
    removedList.innerHTML = '';
    const colorOrder = ['brown', 'gray', 'yellow', 'blue', 'green', 'red', 'purple', 'wonder', 'token'];

    // Build deck: for Age 3, merge guilds from gameData.guilds
    let deckSource = [...gameData.predictorDeck[currentAge]];
    if (currentAge === '3') {
        const guildCards = gameData.guilds.map((g, i) => ({
            id: `a3_guild_${i}`,
            title: g.title,
            type: g.desc,
            color: g.color,
            cost: g.cost,
            dlc: g.dlc
        }));
        deckSource = [...deckSource, ...guildCards];
    }

    const deck = deckSource.sort((a, b) => {
        const indexA = colorOrder.indexOf(a.color);
        const indexB = colorOrder.indexOf(b.color);
        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
    });

    let totalCards = deck.length;
    let removedCount = 0;

    deck.forEach(card => {
        const isRemoved = removedCards.has(card.id);
        if (isRemoved) removedCount++;

        const cardEl = document.createElement('div');
        const colorClass = card.color ? `card-color-${card.color}` : '';
        cardEl.className = `board-card ${colorClass} ${isRemoved ? 'removed' : 'active-in-deck'}`;

        const hasCost = card.cost && card.cost.length > 0;
        const costHtml = hasCost ? `<div class="card-info-badge cost-badge">${getCostHtml(card.cost)}</div>` : '';
        const chainReqHtml = card.chainReq ? `<div class="card-info-badge chain-badge" title="Цепочка: ${card.chainReq}">🔗 ${card.chainReq}</div>` : '';
        const chainGivesHtml = card.chainGiv ? `<div class="card-info-badge chain-gives-indicator" title="Даёт: ${card.chainGiv}">⛓ ${card.chainGiv}</div>` : '';
        const hasInfoRow = hasCost || card.chainReq || card.chainGiv;

        let bgImage = `${currentAge}-epoch.png`;
        if (card.color === 'purple') bgImage = 'guild.png';
        cardEl.style.backgroundImage = `url('assets/cards/${bgImage}')`;

        cardEl.innerHTML = `
            <div class="card-top-bar">
                ${getEffectHtml(card.type)}
            </div>
            ${hasInfoRow ? `<div class="card-info-row">${costHtml}${chainReqHtml}${chainGivesHtml}</div>` : ''}
            <div class="card-bottom-strip">
                <div class="card-title">${card.title}</div>
            </div>
        `;

        cardEl.addEventListener('click', () => {
            if (removedCards.has(card.id)) {
                removedCards.delete(card.id);
            } else {
                removedCards.add(card.id);
            }
            renderPredictor();
        });

        if (isRemoved) {
            removedList.appendChild(cardEl);
        } else {
            predictorList.appendChild(cardEl);
        }
    });

    cardsLeftEl.textContent = totalCards - removedCount;
    cardsRemovedEl.textContent = removedCount;
    removedListCount.textContent = removedCount;
    removedHeader.style.display = removedCount > 0 ? 'block' : 'none';
}

// Start app
document.addEventListener('DOMContentLoaded', init);
