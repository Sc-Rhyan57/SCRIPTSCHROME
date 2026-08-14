(function () {
    if (window.__rcst_hooked) {
        console.warn("[RCST Inspector] O script já está ativo nesta página.");
        return;
    }
    window.__rcst_hooked = true;

    // --- 1. CONFIGURAÇÕES E ESTADOS ---
    window.__rcst_hooks = window.__rcst_hooks || [];
    window.__rcst_blocked = window.__rcst_blocked || new Set();
    window.__rcst_ls_get_hooks = window.__rcst_ls_get_hooks || {};
    window.__rcst_ls_set_hooks = window.__rcst_ls_set_hooks || {};

    // Interceptadores Globais de Rede
    window.addHook = function (f) { window.__rcst_hooks.push(f); };
    window.blockUrl = function (pattern) { window.__rcst_blocked.add(pattern); };
    window.unblockUrl = function (pattern) { window.__rcst_blocked.delete(pattern); };

    // Hooks de LocalStorage
    window.addLocalStorageGetHook = function (key, callback) {
        window.__rcst_ls_get_hooks[key] = callback;
        console.log(`[RCST Storage] Hook de leitura (getItem) adicionado para a chave: ${key}`);
    };

    window.addLocalStorageSetHook = function (key, callback) {
        window.__rcst_ls_set_hooks[key] = callback;
        console.log(`[RCST Storage] Hook de escrita (setItem) adicionado para a chave: ${key}`);
    };

    let autoScroll = true;
    let autoZeroTime = true;

    // --- 2. HOOKS NO PROTÓTIPO DO LOCALSTORAGE ---
    const originalSetItem = Storage.prototype.setItem;
    const originalGetItem = Storage.prototype.getItem;

    Storage.prototype.setItem = function (key, value) {
        let currentValue = value;
        if (this === localStorage && window.__rcst_ls_set_hooks[key]) {
            try {
                const modified = window.__rcst_ls_set_hooks[key](key, currentValue);
                if (modified !== undefined) currentValue = modified;
            } catch (err) {
                console.error(`[RCST LS SetHook Error][${key}]`, err);
            }
        }
        return originalSetItem.call(this, key, currentValue);
    };

    Storage.prototype.getItem = function (key) {
        let currentValue = originalGetItem.call(this, key);
        if (this === localStorage && window.__rcst_ls_get_hooks[key]) {
            try {
                const modified = window.__rcst_ls_get_hooks[key](key, currentValue);
                if (modified !== undefined) currentValue = modified;
            } catch (err) {
                console.error(`[RCST LS GetHook Error][${key}]`, err);
            }
        }
        return currentValue;
    };

    // --- HELPERS ---
    function safeBase64Decode(b64Str) {
        if (typeof b64Str !== 'string') return null;
        try {
            const binStr = atob(b64Str);
            const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
            const decodedStr = new TextDecoder('utf-8').decode(bytes);
            try { return JSON.parse(decodedStr); } catch (e) { return decodedStr; }
        } catch (e) { return null; }
    }

    function safeBase64Encode(objOrStr) {
        try {
            const str = typeof objOrStr === 'object' ? JSON.stringify(objOrStr) : String(objOrStr);
            const bytes = new TextEncoder().encode(str);
            let binStr = "";
            bytes.forEach(b => binStr += String.fromCharCode(b));
            return btoa(binStr);
        } catch (e) { return null; }
    }

    window.__rcst_copy = function (text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showCopied(btn));
        } else {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            showCopied(btn);
        }
    };

    function showCopied(btn) {
        if (!btn) return;
        const orig = btn.innerText;
        btn.innerText = "✓ Copiado!";
        btn.style.background = "#a6e3a1";
        setTimeout(() => {
            btn.innerText = orig;
            btn.style.background = "";
        }, 1500);
    }

    function parseArgs(url, body) {
        let queryParams = {};
        let parsedBody = null;
        try {
            let u = new URL(url, window.location.origin);
            u.searchParams.forEach((val, key) => { queryParams[key] = val; });
        } catch (e) { }

        if (body) {
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                try {
                    let params = new URLSearchParams(body);
                    let obj = {};
                    params.forEach((v, k) => obj[k] = v);
                    parsedBody = Object.keys(obj).length > 0 ? obj : body;
                } catch (err) { parsedBody = body; }
            }
        }
        return { queryParams, parsedBody };
    }

    function applyHooks(d) {
        if (autoZeroTime && d.url && d.url.includes("clickstream")) {
            try {
                let parsed = typeof d.body === 'string' ? JSON.parse(d.body) : d.body;
                if (parsed && parsed.Record && parsed.Record.Data) {
                    let decoded = safeBase64Decode(parsed.Record.Data);
                    if (decoded && typeof decoded === 'object') {
                        if ('spent_time' in decoded) decoded.spent_time = 0;
                        parsed.Record.Data = safeBase64Encode(decoded);
                        d.body = JSON.stringify(parsed);
                        d.modified = true;
                    }
                }
            } catch (e) { }
        }

        window.__rcst_hooks.forEach(f => {
            try { f(d); } catch (e) { }
        });

        return d;
    }

    function isBlocked(url) {
        for (let pattern of window.__rcst_blocked) {
            if (url.includes(pattern)) return true;
        }
        return false;
    }

    // --- 3. INTERFACE GRÁFICA ---
    const uiContainer = document.createElement('div');
    uiContainer.id = 'rcst-inspector-panel';
    uiContainer.innerHTML = `
        <style>
            #rcst-inspector-panel {
                position: fixed;
                bottom: 10px;
                right: 10px;
                width: 620px;
                height: 480px;
                background: #181825;
                color: #cdd6f4;
                font-family: monospace;
                font-size: 11px;
                z-index: 9999999;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                display: flex;
                flex-direction: column;
                border: 1px solid #45475a;
                overflow: hidden;
            }
            #rcst-header {
                background: #11111b;
                padding: 6px 10px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #313244;
                user-select: none;
            }
            #rcst-tabs { display: flex; gap: 4px; }
            .rcst-tab {
                background: #313244;
                border: none;
                color: #a6adc8;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
            }
            .rcst-tab.active { background: #89b4fa; color: #11111b; font-weight: bold; }
            #rcst-actions { display: flex; gap: 4px; align-items: center; }
            #rcst-actions button, .rcst-btn-act, .rcst-btn-copy {
                background: #313244;
                border: 1px solid #45475a;
                color: #cdd6f4;
                padding: 2px 6px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 10px;
            }
            #rcst-actions button:hover, .rcst-btn-act:hover { background: #45475a; }
            #rcst-btn-autoscroll { background: #a6e3a1; color: #11111b !important; font-weight: bold; }
            #rcst-btn-zerotime { background: #f9e2af; color: #11111b !important; font-weight: bold; }
            #rcst-content { flex: 1; overflow-y: auto; padding: 8px; }
            .rcst-log-item { margin-bottom: 8px; padding: 6px; background: #1e1e2e; border-radius: 4px; border: 1px solid #313244; word-break: break-all; }
            .rcst-badge { padding: 1px 4px; border-radius: 3px; font-weight: bold; margin-right: 4px; }
            .badge-xhr { background: #f9e2af; color: #11111b; }
            .badge-fetch { background: #a6e3a1; color: #11111b; }
            .badge-ws-send { background: #fab387; color: #11111b; }
            .badge-ws-recv { background: #94e2d5; color: #11111b; }
            .badge-ws-open { background: #74c7ec; color: #11111b; }
            .badge-clickstream { background: #cba6f7; color: #11111b; }
            .badge-modified { background: #a6e3a1; color: #11111b; }
            .badge-blocked { background: #f38ba8; color: #11111b; }
            .rcst-url { color: #89b4fa; font-weight: bold; }
            .rcst-args-box { margin-top: 4px; padding: 5px; background: #11111b; border-radius: 4px; border: 1px dashed #45475a; color: #a6adc8; max-height: 160px; overflow-y: auto; white-space: pre-wrap; }
            .rcst-decoded-box { margin-top: 6px; padding: 6px; background: #182238; border: 1px solid #89b4fa; border-radius: 4px; }
            .rcst-title { color: #f9e2af; font-weight: bold; }
            .rcst-row-header { display: flex; justify-content: space-between; align-items: center; }
            .rcst-storage-sec { margin-bottom: 12px; }
            .rcst-storage-title { font-weight: bold; color: #89b4fa; border-bottom: 1px solid #313244; padding-bottom: 3px; margin-bottom: 6px; }
            .rcst-input-group { display: flex; gap: 5px; margin-bottom: 6px; flex-wrap: wrap; }
            .rcst-input-group input, .rcst-input-group textarea { flex: 1; background: #11111b; border: 1px solid #45475a; color: #cdd6f4; padding: 4px; border-radius: 4px; font-family: monospace; font-size: 11px; }
            .rcst-input-group textarea { height: 60px; resize: vertical; }
        </style>
        <div id="rcst-header">
            <div id="rcst-tabs">
                <button class="rcst-tab active" onclick="window.__rcst_switchTab('logs')">Network</button>
                <button class="rcst-tab" onclick="window.__rcst_switchTab('lshooks')">Hooks Storage</button>
                <button class="rcst-tab" onclick="window.__rcst_switchTab('rules')">Bloqueios & Injeção</button>
                <button class="rcst-tab" onclick="window.__rcst_switchTab('storage')">Storage</button>
            </div>
            <div id="rcst-actions">
                <button id="rcst-btn-zerotime" onclick="window.__rcst_toggleZeroTime()">Tempo=0: ON</button>
                <button id="rcst-btn-autoscroll" onclick="window.__rcst_toggleAutoScroll()">Scroll: ON</button>
                <button onclick="window.__rcst_clear()">Limpar</button>
                <button onclick="window.__rcst_toggle()">_</button>
            </div>
        </div>
        <div id="rcst-content"></div>
    `;
    document.body.appendChild(uiContainer);

    const contentDiv = document.getElementById('rcst-content');
    let activeTab = 'logs';
    const logsList = [];

    window.__rcst_toggleZeroTime = function () {
        autoZeroTime = !autoZeroTime;
        const btn = document.getElementById('rcst-btn-zerotime');
        if (btn) {
            btn.innerText = autoZeroTime ? 'Tempo=0: ON' : 'Tempo=0: OFF';
            btn.style.background = autoZeroTime ? '#f9e2af' : '#f38ba8';
        }
    };

    window.__rcst_toggleAutoScroll = function () {
        autoScroll = !autoScroll;
        const btn = document.getElementById('rcst-btn-autoscroll');
        if (btn) {
            btn.innerText = autoScroll ? 'Scroll: ON' : 'Scroll: OFF';
            btn.style.background = autoScroll ? '#a6e3a1' : '#f38ba8';
        }
    };

    window.__rcst_switchTab = function (tab) {
        activeTab = tab;
        document.querySelectorAll('.rcst-tab').forEach(b => b.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
        render();
    };

    window.__rcst_clear = function () {
        if (activeTab === 'logs') logsList.length = 0;
        render();
    };

    let isMinimized = false;
    window.__rcst_toggle = function () {
        isMinimized = !isMinimized;
        uiContainer.style.height = isMinimized ? '30px' : '480px';
    };

    function render() {
        contentDiv.innerHTML = '';
        if (activeTab === 'logs') {
            logsList.forEach(item => {
                const el = document.createElement('div');
                el.className = 'rcst-log-item';
                el.innerHTML = item;
                contentDiv.appendChild(el);
            });
            if (autoScroll) contentDiv.scrollTop = contentDiv.scrollHeight;
        } else if (activeTab === 'lshooks') {
            renderLSHooksTab();
        } else if (activeTab === 'rules') {
            renderRulesTab();
        } else if (activeTab === 'storage') {
            renderStorageTab();
        }
    }

    // --- ABA HOOKS LOCALSTORAGE ---
    function renderLSHooksTab() {
        let html = `
            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">⚡ Interceptador de Leitura (getItem Hook)</div>
                <div style="margin-bottom:6px; color:#a6adc8;">Substitui o valor retornado à aplicação quando esta tenta ler uma chave:</div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-ls-get-key" placeholder="Nome da Chave (ex: userData)" style="flex:0.4;" />
                    <textarea id="rcst-ls-get-val" placeholder="Novo Valor a ser retornado (String ou JSON)"></textarea>
                </div>
                <button class="rcst-btn-act" onclick="window.__rcst_addGetHookFromUI()">Aplicar Hook de Leitura</button>
            </div>

            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">💾 Hooks de Leitura Ativos:</div>
                <div class="rcst-args-box">
        `;

        const getKeys = Object.keys(window.__rcst_ls_get_hooks);
        if (getKeys.length === 0) {
            html += `<i>Nenhum hook de leitura ativo.</i>`;
        } else {
            getKeys.forEach(k => {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span><b>${escapeHtml(k)}</b> (Interceptando Leitura)</span>
                    <button class="rcst-btn-act" style="background:#f38ba8; color:#111;" onclick="delete window.__rcst_ls_get_hooks['${escapeHtml(k)}']; renderLSHooksTab();">Remover</button>
                </div>`;
            });
        }

        html += `</div></div>

            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">✍️ Alterar Valor Atual no LocalStorage Direto</div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-ls-direct-key" placeholder="Nome da Chave (ex: userData)" style="flex:0.4;" />
                    <textarea id="rcst-ls-direct-val" placeholder="Novo Valor para gravar"></textarea>
                </div>
                <button class="rcst-btn-act" onclick="window.__rcst_setDirectLS()">Salvar no LocalStorage</button>
            </div>
        `;

        contentDiv.innerHTML = html;
    }

    window.__rcst_addGetHookFromUI = function () {
        const key = document.getElementById('rcst-ls-get-key').value.trim();
        const val = document.getElementById('rcst-ls-get-val').value;
        if (key) {
            window.addLocalStorageGetHook(key, () => val);
            renderLSHooksTab();
        }
    };

    window.__rcst_setDirectLS = function () {
        const key = document.getElementById('rcst-ls-direct-key').value.trim();
        const val = document.getElementById('rcst-ls-direct-val').value;
        if (key) {
            localStorage.setItem(key, val);
            alert(`Chave "${key}" atualizada no LocalStorage!`);
        }
    };

    function renderRulesTab() {
        let html = `
            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">🚫 Bloquear Requisições Enviadas por URL</div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-block-input" placeholder="Ex: clickstream ou /api/analytics" />
                    <button class="rcst-btn-act" onclick="window.__rcst_addBlockFromUI()">Adicionar Bloqueio</button>
                </div>
                <div><b>Filtros de Bloqueio Ativos:</b></div>
                <div class="rcst-args-box">
        `;

        if (window.__rcst_blocked.size === 0) {
            html += `<i>Nenhum bloqueio configurado.</i>`;
        } else {
            window.__rcst_blocked.forEach(pattern => {
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                    <span>${escapeHtml(pattern)}</span>
                    <button class="rcst-btn-act" style="background:#f38ba8; color:#111;" onclick="window.unblockUrl('${escapeHtml(pattern)}'); renderRulesTab();">Remover</button>
                </div>`;
            });
        }

        html += `</div></div>`;
        contentDiv.innerHTML = html;
    }

    window.__rcst_addBlockFromUI = function () {
        const inp = document.getElementById('rcst-block-input');
        if (inp && inp.value.trim()) {
            window.blockUrl(inp.value.trim());
            inp.value = '';
            renderRulesTab();
        }
    };

    function renderStorageTab() {
        let html = '';

        html += `<div class="rcst-storage-sec"><div class="rcst-storage-title">LocalStorage (${localStorage.length})</div>`;
        if (localStorage.length === 0) html += `<i>Vazio</i>`;
        else {
            let lsObj = {};
            for (let i = 0; i < localStorage.length; i++) {
                let k = localStorage.key(i);
                lsObj[k] = localStorage.getItem(k);
            }
            html += `<button class="rcst-btn-copy" onclick="window.__rcst_copy(this.nextElementSibling.innerText, this)">Copiar LocalStorage</button>`;
            html += `<div class="rcst-args-box">${escapeHtml(JSON.stringify(lsObj, null, 2))}</div>`;
        }
        html += `</div>`;

        html += `<div class="rcst-storage-sec"><div class="rcst-storage-title">SessionStorage (${sessionStorage.length})</div>`;
        if (sessionStorage.length === 0) html += `<i>Vazio</i>`;
        else {
            let ssObj = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                let k = sessionStorage.key(i);
                ssObj[k] = sessionStorage.getItem(k);
            }
            html += `<button class="rcst-btn-copy" onclick="window.__rcst_copy(this.nextElementSibling.innerText, this)">Copiar SessionStorage</button>`;
            html += `<div class="rcst-args-box">${escapeHtml(JSON.stringify(ssObj, null, 2))}</div>`;
        }
        html += `</div>`;

        html += `<div class="rcst-storage-sec"><div class="rcst-storage-title">Cookies</div>`;
        if (!document.cookie) html += `<i>Nenhum cookie visível</i>`;
        else {
            html += `<button class="rcst-btn-copy" onclick="window.__rcst_copy(this.nextElementSibling.innerText, this)">Copiar Cookies</button>`;
            html += `<div class="rcst-args-box">${escapeHtml(document.cookie.split('; ').join('\n'))}</div>`;
        }
        html += `</div>`;

        contentDiv.innerHTML = html;
    }

    function addLogToUI(data) {
        let badgeClass = 'badge-xhr';
        if (data.type.startsWith('fetch')) badgeClass = 'badge-fetch';
        else if (data.type === 'ws-send') badgeClass = 'badge-ws-send';
        else if (data.type === 'ws-recv') badgeClass = 'badge-ws-recv';
        else if (data.type === 'ws-open') badgeClass = 'badge-ws-open';

        const isClickstream = data.url.includes('clickstream');
        if (isClickstream) badgeClass = 'badge-clickstream';
        if (data.blocked) badgeClass = 'badge-blocked';

        const args = parseArgs(data.url, data.body);
        const hasQuery = Object.keys(args.queryParams).length > 0;
        const hasBody = args.parsedBody !== null && args.parsedBody !== '';
        const hasReqHeaders = data.headers && Object.keys(data.headers).length > 0;
        const hasResHeaders = data.resHeaders && Object.keys(data.resHeaders).length > 0;

        let decodedPayload = null;
        if (args.parsedBody && typeof args.parsedBody === 'object') {
            if (args.parsedBody.Record && args.parsedBody.Record.Data) {
                decodedPayload = safeBase64Decode(args.parsedBody.Record.Data);
            } else if (args.parsedBody.Data) {
                decodedPayload = safeBase64Decode(args.parsedBody.Data);
            }
        }

        let detailsObject = {
            url: data.url,
            method: data.method,
            status: data.status,
            requestHeaders: data.headers || {},
            queryParams: args.queryParams,
            requestBody: args.parsedBody,
            decodedPayload: decodedPayload,
            responseHeaders: data.resHeaders || {},
            responseBody: data.responseBody || ''
        };

        const rawJsonToCopy = escapeHtml(JSON.stringify(detailsObject, null, 2));
        let argsHtml = '';

        if (decodedPayload) {
            argsHtml += `
                <div class="rcst-decoded-box">
                    <div class="rcst-row-header">
                        <span class="rcst-title" style="color:#89b4fa;">🔓 Payload Decodificado (Clickstream):</span>
                        <button class="rcst-btn-copy" onclick="window.__rcst_copy(this.getAttribute('data-dec'), this)" data-dec="${escapeHtml(JSON.stringify(decodedPayload, null, 2))}">Copiar Decodificado</button>
                    </div>
                    <div class="rcst-args-box">${escapeHtml(JSON.stringify(decodedPayload, null, 2))}</div>
                </div>
            `;
        }

        if (hasReqHeaders) {
            argsHtml += `<div><span class="rcst-title">Request Headers:</span></div>`;
            argsHtml += `<div class="rcst-args-box">${escapeHtml(JSON.stringify(data.headers, null, 2))}</div>`;
        }

        if (hasQuery) {
            argsHtml += `<div><span class="rcst-title">Query Args:</span></div>`;
            argsHtml += `<div class="rcst-args-box">${escapeHtml(JSON.stringify(args.queryParams, null, 2))}</div>`;
        }

        if (hasBody) {
            argsHtml += `<div><span class="rcst-title">Payload / Body:</span></div>`;
            argsHtml += `<div class="rcst-args-box">${escapeHtml(typeof args.parsedBody === 'object' ? JSON.stringify(args.parsedBody, null, 2) : String(args.parsedBody))}</div>`;
        }

        if (hasResHeaders) {
            argsHtml += `<div><span class="rcst-title">Response Headers:</span></div>`;
            argsHtml += `<div class="rcst-args-box">${escapeHtml(JSON.stringify(data.resHeaders, null, 2))}</div>`;
        }

        if (data.responseBody) {
            argsHtml += `<div class="rcst-row-header" style="margin-top:4px;">
                <span class="rcst-title">Response Body:</span>
                <button class="rcst-btn-copy" onclick="window.__rcst_copy(this.getAttribute('data-resp'), this)" data-resp="${escapeHtml(data.responseBody)}">Copiar Resposta</button>
            </div>`;
            argsHtml += `<div class="rcst-args-box">${escapeHtml(data.responseBody)}</div>`;
        }

        const modifiedTag = data.modified ? `<span class="rcst-badge badge-modified">INJETADO (spent_time=0)</span>` : '';
        const blockedTag = data.blocked ? `<span class="rcst-badge badge-blocked">BLOQUEADO</span>` : '';
        const statusTag = data.status ? ` [${data.status}]` : '';

        const html = `
            <div class="rcst-row-header">
                <div>
                    <span class="rcst-badge ${badgeClass}">${data.blocked ? 'BLOCKED' : (isClickstream ? 'CLICKSTREAM' : (data.method || data.type.toUpperCase()))}</span>
                    ${modifiedTag}
                    ${blockedTag}
                    <span class="rcst-url">${data.url}</span>${statusTag}
                </div>
                <button class="rcst-btn-copy" onclick="window.__rcst_copy(this.getAttribute('data-raw'), this)" data-raw="${rawJsonToCopy}">Copiar Tudo</button>
            </div>
            ${argsHtml}
        `;

        logsList.push(html);
        if (logsList.length > 200) logsList.shift();
        if (activeTab === 'logs') render();
    }

    function escapeHtml(str) {
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function parseXHRResponseHeaders(headerStr) {
        var headers = {};
        if (!headerStr) return headers;
        var headerPairs = headerStr.trim().split('\u000d\u000a');
        for (var i = 0; i < headerPairs.length; i++) {
            var headerPair = headerPairs[i];
            var index = headerPair.indexOf('\u003a\u0020');
            if (index > 0) {
                var key = headerPair.substring(0, index);
                var val = headerPair.substring(index + 2);
                headers[key] = val;
            }
        }
        return headers;
    }

    // --- 4. INTERCEPTADORES DE REDE (XHR & Fetch) ---
    var oO = XMLHttpRequest.prototype.open, oS = XMLHttpRequest.prototype.send, oH = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; this.__h = {}; return oO.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (n, v) { this.__h[n] = v; };
    XMLHttpRequest.prototype.send = function (b) {
        var self = this;
        var origBody = b ? String(b) : '';
        var origUrl = this.__u;

        var d = { type: 'xhr', method: this.__m, url: this.__u, headers: this.__h, body: origBody };
        applyHooks(d);

        var isModified = (d.body !== origBody || d.url !== origUrl || d.modified);

        if (isBlocked(d.url)) {
            addLogToUI({ type: 'xhr', method: d.method, url: d.url, status: 0, responseBody: 'Requisição cancelada pelo RCST Inspector', blocked: true });
            return;
        }

        for (var k in d.headers) { oH.call(this, k, d.headers[k]); }

        this.addEventListener('load', function () {
            var resHeaders = parseXHRResponseHeaders(self.getAllResponseHeaders());
            addLogToUI({
                type: 'xhr',
                method: self.__m,
                url: self.__u,
                headers: d.headers,
                resHeaders: resHeaders,
                body: d.body,
                status: self.status,
                responseBody: self.responseText || '',
                modified: isModified
            });
        });

        if (d.method === 'GET' || d.method === 'HEAD') { return oS.call(this, null); }
        return oS.call(this, d.body || null);
    };

    var oF = window.fetch;
    window.fetch = function (i, init) {
        var u = typeof i === 'string' ? i : (i && i.url) || '';
        var m = (init && init.method) || 'GET';
        var hd = {};
        var rh = (init && init.headers) || (i && i.headers);
        if (rh) { if (rh instanceof Headers) { rh.forEach(function (v, k) { hd[k] = v; }); } else if (typeof rh === 'object') { for (var k in rh) { hd[k] = rh[k]; } } }
        var b = (init && init.body) ? String(init.body) : '';

        var d = { type: 'fetch', method: m, url: u, headers: hd, body: b };
        applyHooks(d);

        var isModified = (d.body !== b || d.url !== u || d.modified);

        if (isBlocked(d.url)) {
            addLogToUI({ type: 'fetch', method: m, url: d.url, body: d.body, status: 0, responseBody: 'Requisição cancelada pelo RCST Inspector', blocked: true });
            return Promise.reject(new Error('Bloqueado pelo RCST Inspector'));
        }

        init = init || {};
        init.headers = d.headers;
        if (d.body && d.body.length > 0) { init.body = d.body; } else { try { delete init.body; } catch (e) { } }

        return oF.call(this, d.url, init).then(function (r) {
            var resHeaders = {};
            if (r.headers) { r.headers.forEach(function (v, k) { resHeaders[k] = v; }); }
            r.clone().text().then(function (t) {
                addLogToUI({
                    type: 'fetch',
                    method: m,
                    url: d.url,
                    headers: d.headers,
                    resHeaders: resHeaders,
                    body: d.body,
                    status: r.status,
                    responseBody: t || '',
                    modified: isModified
                });
            });
            return r;
        });
    };

    // --- 5. INTERCEPTADOR DE WEBSOCKETS ---
    const NativeWebSocket = window.WebSocket;

    function CustomWebSocket(url, protocols) {
        const wsInstance = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
        let wsUrl = url;

        if (isBlocked(wsUrl)) {
            addLogToUI({ type: 'ws-send', method: 'WS-BLOCKED', url: wsUrl, status: 0, responseBody: 'WebSocket bloqueado no momento do handshake.', blocked: true });
            wsInstance.close();
            return wsInstance;
        }

        addLogToUI({ type: 'ws-open', method: 'WS-OPEN', url: wsUrl, status: 101, responseBody: 'Conexão WebSocket iniciada.' });

        // Intercepta envio (send)
        const originalSend = wsInstance.send;
        wsInstance.send = function (data) {
            let bodyStr = typeof data === 'string' ? data : (data instanceof ArrayBuffer ? '[ArrayBuffer Data]' : String(data));
            let d = { type: 'ws-send', method: 'WS-SEND', url: wsUrl, body: bodyStr };
            
            applyHooks(d);

            if (isBlocked(wsUrl)) {
                addLogToUI({ type: 'ws-send', method: 'WS-SEND', url: wsUrl, body: d.body, blocked: true });
                return;
            }

            addLogToUI({
                type: 'ws-send',
                method: 'WS-SEND',
                url: wsUrl,
                body: d.body,
                modified: d.body !== bodyStr || d.modified
            });

            return originalSend.call(this, d.body);
        };

        // Intercepta recepção (onmessage / addEventListener)
        wsInstance.addEventListener('message', function (event) {
            let msgData = typeof event.data === 'string' ? event.data : (event.data instanceof ArrayBuffer ? '[ArrayBuffer Data]' : String(event.data));
            let d = { type: 'ws-recv', method: 'WS-RECV', url: wsUrl, responseBody: msgData };
            
            applyHooks(d);

            addLogToUI({
                type: 'ws-recv',
                method: 'WS-RECV',
                url: wsUrl,
                responseBody: d.responseBody || msgData,
                modified: d.modified
            });
        });

        return wsInstance;
    }

    // Copia protótipos e constantes estáticas do WebSocket nativo (CONNECTING, OPEN, CLOSING, CLOSED)
    CustomWebSocket.prototype = NativeWebSocket.prototype;
    Object.keys(NativeWebSocket).forEach(key => {
        CustomWebSocket[key] = NativeWebSocket[key];
    });

    window.WebSocket = CustomWebSocket;

    console.log("[RCST Inspector] Inicializado com sucesso! Suporte a WebSockets (WS/WSS) ativado.");
})();
