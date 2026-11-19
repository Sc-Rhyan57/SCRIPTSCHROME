(function () {
    if (window.__rcst_hooked) {
        console.warn("[RCST Inspector] O script já está ativo nesta página.");
        return;
    }
    window.__rcst_hooked = true;

    // fetch nativo guardado ANTES de ser sobrescrito (usado por replay e crawler, não passa pelos hooks)
    const nativeFetch = window.fetch.bind(window);

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
    const sleep = ms => new Promise(r => setTimeout(r, ms));

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

    function escapeHtml(str) {
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
                width: 700px;
                max-width: 96vw;
                height: 520px;
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
                flex-wrap: wrap;
                gap: 6px;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #313244;
                user-select: none;
            }
            #rcst-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
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
            #rcst-actions button:hover, .rcst-btn-act:hover, .rcst-btn-copy:hover { background: #45475a; }
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
            .badge-replay { background: #f5c2e7; color: #11111b; }
            .rcst-url { color: #89b4fa; font-weight: bold; }
            .rcst-args-box { margin-top: 4px; padding: 5px; background: #11111b; border-radius: 4px; border: 1px dashed #45475a; color: #a6adc8; max-height: 160px; overflow-y: auto; white-space: pre-wrap; }
            .rcst-decoded-box { margin-top: 6px; padding: 6px; background: #182238; border: 1px solid #89b4fa; border-radius: 4px; }
            .rcst-title { color: #f9e2af; font-weight: bold; }
            .rcst-row-header { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
            .rcst-row-btns { display: flex; gap: 4px; flex-shrink: 0; }
            .rcst-storage-sec { margin-bottom: 12px; }
            .rcst-storage-title { font-weight: bold; color: #89b4fa; border-bottom: 1px solid #313244; padding-bottom: 3px; margin-bottom: 6px; }
            .rcst-input-group { display: flex; gap: 5px; margin-bottom: 6px; flex-wrap: wrap; align-items: center; }
            .rcst-input-group input[type=text], .rcst-input-group input[type=number], .rcst-input-group textarea { flex: 1; background: #11111b; border: 1px solid #45475a; color: #cdd6f4; padding: 4px; border-radius: 4px; font-family: monospace; font-size: 11px; }
            .rcst-input-group textarea { height: 60px; resize: vertical; }
            .rcst-input-group label { color: #a6adc8; }
        </style>
        <div id="rcst-header">
            <div id="rcst-tabs">
                <button class="rcst-tab active" data-tab="logs" onclick="window.__rcst_switchTab('logs')">Network</button>
                <button class="rcst-tab" data-tab="replay" onclick="window.__rcst_switchTab('replay')">Replay</button>
                <button class="rcst-tab" data-tab="pages" onclick="window.__rcst_switchTab('pages')">Páginas</button>
                <button class="rcst-tab" data-tab="lshooks" onclick="window.__rcst_switchTab('lshooks')">Hooks Storage</button>
                <button class="rcst-tab" data-tab="rules" onclick="window.__rcst_switchTab('rules')">Bloqueios</button>
                <button class="rcst-tab" data-tab="storage" onclick="window.__rcst_switchTab('storage')">Storage</button>
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

    function setTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.rcst-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        render();
    }
    window.__rcst_switchTab = setTab;

    window.__rcst_clear = function () {
        if (activeTab === 'logs') logsList.length = 0;
        render();
    };

    let isMinimized = false;
    window.__rcst_toggle = function () {
        isMinimized = !isMinimized;
        const h = document.getElementById('rcst-header').offsetHeight + 2;
        uiContainer.style.height = isMinimized ? h + 'px' : '520px';
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
        } else if (activeTab === 'replay') {
            renderReplayTab();
        } else if (activeTab === 'pages') {
            renderPagesTab();
        } else if (activeTab === 'lshooks') {
            renderLSHooksTab();
        } else if (activeTab === 'rules') {
            renderRulesTab();
        } else if (activeTab === 'storage') {
            renderStorageTab();
        }
    }

    // =====================================================================
    // REPLAY DE REQUISIÇÕES
    // =====================================================================
    const reqStore = [];   // guarda as requisições (já pós-hooks) para repetir
    let replayDraft = { method: 'GET', url: '', headers: '{}', body: '' };
    let replayResult = '';

    async function runReplay(req) {
        const method = (req.method || 'GET').toUpperCase();
        const init = { method, headers: req.headers || {}, credentials: 'include' };
        if (method !== 'GET' && method !== 'HEAD' && req.body) init.body = req.body;
        const t0 = performance.now();
        try {
            const r = await nativeFetch(req.url, init);
            const resHeaders = {};
            r.headers.forEach((v, k) => { resHeaders[k] = v; });
            const text = await r.text();
            const ms = Math.round(performance.now() - t0);
            addLogToUI({
                type: 'fetch', method, url: req.url, headers: init.headers, resHeaders,
                body: req.body || '', status: r.status, responseBody: text, replay: true, ms
            });
            return { status: r.status, ms, headers: resHeaders, body: text };
        } catch (e) {
            addLogToUI({
                type: 'fetch', method, url: req.url, headers: init.headers, body: req.body || '',
                status: 0, responseBody: 'Erro no replay: ' + e.message, replay: true
            });
            return { error: e.message };
        }
    }

    window.__rcst_replay = async function (id, btn) {
        const req = reqStore[id];
        if (!req) return;
        if (btn) btn.innerText = '…';
        await runReplay(req);
    };

    window.__rcst_editReplay = function (id) {
        const r = reqStore[id];
        if (!r) return;
        replayDraft = {
            method: r.method || 'GET',
            url: r.url,
            headers: JSON.stringify(r.headers || {}, null, 2),
            body: r.body || ''
        };
        replayResult = '';
        setTab('replay');
    };

    window.__rcst_sendDraft = async function () {
        const g = id => document.getElementById(id);
        replayDraft.method = g('rcst-rp-method').value.trim() || 'GET';
        replayDraft.url = g('rcst-rp-url').value.trim();
        replayDraft.headers = g('rcst-rp-headers').value;
        replayDraft.body = g('rcst-rp-body').value;

        let headers = {};
        try { headers = replayDraft.headers.trim() ? JSON.parse(replayDraft.headers) : {}; }
        catch (e) { replayResult = 'Headers inválidos (precisa ser JSON): ' + e.message; renderReplayTab(); return; }
        if (!replayDraft.url) { replayResult = 'Informe a URL.'; renderReplayTab(); return; }

        replayResult = 'Enviando...';
        renderReplayTab();
        const res = await runReplay({ method: replayDraft.method, url: replayDraft.url, headers, body: replayDraft.body });
        if (res.error) replayResult = 'ERRO: ' + res.error;
        else replayResult = `HTTP ${res.status}  (${res.ms}ms)\n\n--- Response Headers ---\n${JSON.stringify(res.headers, null, 2)}\n\n--- Response Body ---\n${res.body}`;
        if (activeTab === 'replay') renderReplayTab();
    };

    function renderReplayTab() {
        contentDiv.innerHTML = `
            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">↻ Editar e Repetir Requisição</div>
                <div style="margin-bottom:6px; color:#a6adc8;">Use "✎ Editar" em qualquer item da aba Network para carregar aqui. A resposta aparece abaixo e também na aba Network (badge REPLAY). A aplicação NÃO recebe a resposta.</div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-rp-method" value="${escapeHtml(replayDraft.method)}" style="flex:0.2;" placeholder="Método" />
                    <input type="text" id="rcst-rp-url" value="${escapeHtml(replayDraft.url)}" placeholder="URL" />
                </div>
                <div class="rcst-input-group"><textarea id="rcst-rp-headers" placeholder='Headers (JSON)'>${escapeHtml(replayDraft.headers)}</textarea></div>
                <div class="rcst-input-group"><textarea id="rcst-rp-body" placeholder="Body">${escapeHtml(replayDraft.body)}</textarea></div>
                <button class="rcst-btn-act" onclick="window.__rcst_sendDraft()">Enviar</button>
            </div>
            <div class="rcst-storage-sec">
                <div class="rcst-row-header">
                    <div class="rcst-storage-title" style="flex:1;">Resposta</div>
                    <button class="rcst-btn-copy" onclick="window.__rcst_copy(this.getAttribute('data-r'), this)" data-r="${escapeHtml(replayResult)}">Copiar</button>
                </div>
                <div class="rcst-args-box" style="max-height:240px;">${replayResult ? escapeHtml(replayResult) : '<i>Nenhuma resposta ainda.</i>'}</div>
            </div>
        `;
    }

    // =====================================================================
    // DOWNLOAD DE PÁGINA + CRAWLER
    // =====================================================================
    const cssTextCache = new Map();
    const imgCache = new Map();
    const htmlCache = new Map();

    const cfg = {
        depth: 1,
        max: 20,
        include: '',
        exclude: 'logout|logoff|signout|sair|delete|excluir|remove',
        delay: 200,
        keepScripts: false,
        inlineImages: true
    };
    let discovered = [];   // { url, checked }
    let pagesStatus = '';

    const NON_HTML = /\.(pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|mp4|mp3|avi|mov|css|js|json|xml|docx?|xlsx?|pptx?|csv|txt|woff2?|ttf)$/i;

    function setStatus(t) {
        pagesStatus = t;
        const el = document.getElementById('rcst-pages-status');
        if (el) el.textContent = t;
    }

    function blobToDataURL(blob) {
        return new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
        });
    }

    function absUrl(v, base) {
        if (!v) return v;
        const t = v.trim();
        if (!t || t[0] === '#' || /^(data:|javascript:|mailto:|tel:|blob:|about:)/i.test(t)) return v;
        try { return new URL(t, base).href; } catch (e) { return v; }
    }

    function cssAbs(css, base) {
        return css
            .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url("${absUrl(u, base)}")`)
            .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import "${absUrl(u, base)}"`);
    }

    function srcsetAbs(s, base) {
        return s.split(',').map(p => {
            const parts = p.trim().split(/\s+/);
            parts[0] = absUrl(parts[0], base);
            return parts.join(' ');
        }).join(', ');
    }

    function normUrl(href, base) {
        try {
            const u = new URL(href, base);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            u.hash = '';
            return u.href;
        } catch (e) { return null; }
    }

    function saveBlob(name, blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    function uniqueName(url, used) {
        const u = new URL(url);
        let base = (u.pathname.replace(/^\/+|\/+$/g, '') || 'index').replace(/[^\w.\-]+/g, '_');
        if (u.search) base += '_' + u.search.slice(1).replace(/[^\w]+/g, '_').slice(0, 40);
        base = base.replace(/\.(html?|php|aspx?|jsp)$/i, '');
        let name = base + '.html', n = 1;
        while (used.has(name)) name = `${base}_${n++}.html`;
        used.add(name);
        return name;
    }

    // Processa um Document: absolutiza URLs, embute CSS e imagens, remove scripts (opcional)
    async function processDoc(d, baseUrl, opts) {
        const panel = d.getElementById('rcst-inspector-panel');
        if (panel) panel.remove();
        d.querySelectorAll('base').forEach(b => b.remove());

        // 1) URLs absolutas
        const attrs = ['href', 'src', 'poster', 'action', 'data-src'];
        d.querySelectorAll('[href],[src],[poster],[action],[data-src],[srcset]').forEach(el => {
            attrs.forEach(a => { if (el.hasAttribute(a)) el.setAttribute(a, absUrl(el.getAttribute(a), baseUrl)); });
            if (el.hasAttribute('srcset')) el.setAttribute('srcset', srcsetAbs(el.getAttribute('srcset'), baseUrl));
        });
        d.querySelectorAll('[style*="url("]').forEach(el => el.setAttribute('style', cssAbs(el.getAttribute('style'), baseUrl)));

        // 2) links entre páginas baixadas apontam para os arquivos locais
        if (opts.linkMap) {
            d.querySelectorAll('a[href]').forEach(a => {
                try {
                    const u = new URL(a.getAttribute('href'));
                    const hash = u.hash;
                    u.hash = '';
                    const f = opts.linkMap.get(u.href);
                    if (f) a.setAttribute('href', './' + f + hash);
                } catch (e) { }
            });
        }

        // 3) scripts
        if (!opts.keepScripts) {
            d.querySelectorAll('script, link[rel=modulepreload], link[rel=preload][as=script]').forEach(e => e.remove());
        }

        // 4) CSS embutido
        d.querySelectorAll('style').forEach(s => { s.textContent = cssAbs(s.textContent, baseUrl); });
        const links = [...d.querySelectorAll('link[rel~="stylesheet"][href]')];
        await Promise.all(links.map(async l => {
            const href = l.getAttribute('href');
            try {
                let css = cssTextCache.get(href);
                if (css === undefined) {
                    const r = await nativeFetch(href, { credentials: 'include' });
                    if (!r.ok) throw new Error('http ' + r.status);
                    css = cssAbs(await r.text(), href);
                    cssTextCache.set(href, css);
                }
                const st = d.createElement('style');
                st.setAttribute('data-inlined-from', href);
                if (l.getAttribute('media')) st.setAttribute('media', l.getAttribute('media'));
                st.textContent = css;
                l.replaceWith(st);
            } catch (e) { /* mantém o <link> com URL absoluta */ }
        }));

        // 5) imagens embutidas (data URI)
        if (opts.inlineImages) {
            const imgs = [...d.querySelectorAll('img[src]')].filter(i => !/^data:/i.test(i.getAttribute('src')));
            for (let i = 0; i < imgs.length; i += 6) {
                await Promise.all(imgs.slice(i, i + 6).map(async img => {
                    const src = img.getAttribute('src');
                    try {
                        let du = imgCache.get(src);
                        if (du === undefined) {
                            const r = await nativeFetch(src, { credentials: 'include' });
                            if (!r.ok) throw new Error('http ' + r.status);
                            const b = await r.blob();
                            if (b.size > 5 * 1024 * 1024) throw new Error('grande demais');
                            du = await blobToDataURL(b);
                            imgCache.set(src, du);
                        }
                        img.setAttribute('src', du);
                        img.removeAttribute('srcset');
                        img.removeAttribute('loading');
                    } catch (e) { /* mantém URL absoluta */ }
                }));
            }
        }

        return serializeDoc(d, baseUrl);
    }

    function serializeDoc(d, baseUrl) {
        const dt = d.doctype ? new XMLSerializer().serializeToString(d.doctype) : '<!DOCTYPE html>';
        return `${dt}\n<!-- Salvo de ${baseUrl} em ${new Date().toISOString()} -->\n${d.documentElement.outerHTML}`;
    }

    // Snapshot do DOM ATUAL (com alterações de JS, valores de formulário, canvas, CSS dinâmico)
    async function snapshotCurrent(opts) {
        const live = document;
        const clone = document.cloneNode(true);
        const q = (doc, s) => [...doc.querySelectorAll(s)];

        // valores de formulário
        const lf = q(live, 'input,textarea,select'), cf = q(clone, 'input,textarea,select');
        lf.forEach((el, i) => {
            const c = cf[i];
            if (!c) return;
            if (el.tagName === 'TEXTAREA') c.textContent = el.value;
            else if (el.tagName === 'SELECT') {
                [...c.options].forEach((o, j) => {
                    if (el.options[j] && el.options[j].selected) o.setAttribute('selected', '');
                    else o.removeAttribute('selected');
                });
            } else if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked');
            } else if (el.type !== 'file' && el.type !== 'password') {
                c.setAttribute('value', el.value);
            }
        });

        // <style> preenchidos via CSSOM (CSS-in-JS) e adoptedStyleSheets
        const ls = q(live, 'style'), cs = q(clone, 'style');
        ls.forEach((s, i) => {
            if (cs[i] && !cs[i].textContent.trim() && s.sheet) {
                try { cs[i].textContent = [...s.sheet.cssRules].map(r => r.cssText).join('\n'); } catch (e) { }
            }
        });
        if (live.adoptedStyleSheets && live.adoptedStyleSheets.length) {
            try {
                const st = clone.createElement('style');
                st.textContent = live.adoptedStyleSheets.flatMap(s => [...s.cssRules].map(r => r.cssText)).join('\n');
                clone.head.appendChild(st);
            } catch (e) { }
        }

        // imagens: usa a fonte realmente carregada (lazy-load / srcset)
        const li = q(live, 'img'), ci = q(clone, 'img');
        li.forEach((im, i) => {
            if (ci[i] && im.currentSrc) { ci[i].setAttribute('src', im.currentSrc); ci[i].removeAttribute('srcset'); }
        });

        // canvas -> imagem (por último, pois altera a contagem de <img>)
        const lc = q(live, 'canvas'), cc = q(clone, 'canvas');
        lc.forEach((cv, i) => {
            try {
                const img = clone.createElement('img');
                img.src = cv.toDataURL();
                img.width = cv.width; img.height = cv.height;
                ['class', 'style', 'id'].forEach(a => { if (cv.getAttribute(a)) img.setAttribute(a, cv.getAttribute(a)); });
                cc[i].replaceWith(img);
            } catch (e) { /* canvas "tainted" */ }
        });

        if (opts.raw) {
            const p = clone.getElementById('rcst-inspector-panel');
            if (p) p.remove();
            const base = clone.createElement('base');
            base.href = location.href;
            clone.head.insertBefore(base, clone.head.firstChild);
            return serializeDoc(clone, location.href);
        }
        return processDoc(clone, location.href, opts);
    }

    function currentFileName() {
        return ((document.title || location.hostname).replace(/[^\w\-]+/g, '_').slice(0, 60) || 'pagina') + '.html';
    }

    // ---------- ZIP mínimo (sem compressão) ----------
    const crcTable = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(buf) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function makeZip(files) {
        const enc = new TextEncoder();
        const chunks = [], central = [];
        let offset = 0;
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

        files.forEach(f => {
            const nameB = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
            lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
            lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
            lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
            chunks.push(new Uint8Array(lh.buffer), nameB, data);

            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
            ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
            ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
            ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true);
            ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true);
            ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), nameB);

            offset += 30 + nameB.length + data.length;
        });

        const cdSize = central.reduce((s, c) => s + c.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
        end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);

        return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    }

    // ---------- Crawler ----------
    function readCfg() {
        const g = id => document.getElementById(id);
        if (!g('rcst-cfg-depth')) return;
        cfg.depth = Math.max(0, parseInt(g('rcst-cfg-depth').value) || 0);
        cfg.max = Math.max(1, parseInt(g('rcst-cfg-max').value) || 1);
        cfg.delay = Math.max(0, parseInt(g('rcst-cfg-delay').value) || 0);
        cfg.include = g('rcst-cfg-include').value.trim();
        cfg.exclude = g('rcst-cfg-exclude').value.trim();
        cfg.keepScripts = g('rcst-cfg-scripts').checked;
        cfg.inlineImages = g('rcst-cfg-images').checked;
    }

    function makeFilter() {
        const mk = s => {
            if (!s) return null;
            try { return new RegExp(s, 'i'); }
            catch (e) { return { test: u => u.toLowerCase().includes(s.toLowerCase()) }; }
        };
        const inc = mk(cfg.include), exc = mk(cfg.exclude);
        return u => {
            const p = new URL(u).pathname;
            if (NON_HTML.test(p)) return false;
            if (inc && !inc.test(u)) return false;
            if (exc && exc.test(u)) return false;
            return true;
        };
    }

    async function fetchHtml(url) {
        const r = await nativeFetch(url, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !/html/i.test(ct)) throw new Error('não é HTML / http ' + r.status);
        return r.text();
    }

    // Busca em largura a partir da página atual (somente mesmo domínio, somente GET)
    async function discoverPages() {
        readCfg();
        const ok = makeFilter();
        const start = normUrl(location.href, location.href);
        const seen = new Set([start]);
        const found = [];
        const bad = new Set();
        const queue = [{ url: start, d: 0 }];
        htmlCache.clear();

        while (queue.length) {
            const { url, d } = queue.shift();
            if (d >= cfg.depth) continue;

            let doc;
            if (d === 0) {
                doc = document;
            } else {
                setStatus(`Analisando (${found.length}/${cfg.max}): ${url}`);
                try {
                    const html = await fetchHtml(url);
                    htmlCache.set(url, html);
                    doc = new DOMParser().parseFromString(html, 'text/html');
                } catch (e) { bad.add(url); continue; }
                await sleep(cfg.delay);
            }

            for (const a of doc.querySelectorAll('a[href]')) {
                if (found.length >= cfg.max) break;
                const u = normUrl(a.getAttribute('href'), url);
                if (!u || seen.has(u)) continue;
                seen.add(u);
                if (new URL(u).origin !== location.origin) continue;
                if (!ok(u)) continue;
                found.push(u);
                queue.push({ url: u, d: d + 1 });
            }
        }
        return found.filter(u => !bad.has(u));
    }

    async function downloadPages(urls) {
        readCfg();
        const cur = normUrl(location.href, location.href);
        const all = [cur, ...urls.filter(u => u !== cur)];
        const used = new Set();
        const linkMap = new Map();
        all.forEach(u => linkMap.set(u, uniqueName(u, used)));
        const opts = { keepScripts: cfg.keepScripts, inlineImages: cfg.inlineImages, linkMap };
        const files = [];

        setStatus('Salvando página atual...');
        files.push({ name: linkMap.get(cur), data: await snapshotCurrent(opts) });

        let i = 0;
        for (const u of all.slice(1)) {
            i++;
            setStatus(`Baixando ${i}/${all.length - 1}: ${u}`);
            try {
                let html = htmlCache.get(u);
                if (html === undefined) html = await fetchHtml(u);
                const d = new DOMParser().parseFromString(html, 'text/html');
                files.push({ name: linkMap.get(u), data: await processDoc(d, u, opts) });
            } catch (e) {
                console.warn('[RCST] Falha ao baixar', u, e);
            }
            await sleep(cfg.delay);
        }

        saveBlob(`paginas_${location.hostname}_${Date.now()}.zip`, makeZip(files));
        setStatus(`Concluído: ${files.length} página(s) salvas em ZIP.`);
    }

    window.__rcst_savePage = async function (raw) {
        readCfg();
        setStatus('Gerando arquivo...');
        try {
            const html = await snapshotCurrent({ raw, keepScripts: cfg.keepScripts, inlineImages: cfg.inlineImages });
            saveBlob(currentFileName(), new Blob([html], { type: 'text/html;charset=utf-8' }));
            setStatus('Página salva.');
        } catch (e) {
            setStatus('Erro ao salvar: ' + e.message);
        }
    };

    window.__rcst_discover = async function () {
        setStatus('Procurando páginas...');
        try {
            const urls = await discoverPages();
            discovered = urls.map(u => ({ url: u, checked: true }));
            setStatus(`${urls.length} página(s) encontrada(s).`);
        } catch (e) { setStatus('Erro: ' + e.message); }
        if (activeTab === 'pages') renderPagesTab();
    };

    window.__rcst_downloadSelected = async function () {
        readCfg();
        try { await downloadPages(discovered.filter(x => x.checked).map(x => x.url)); }
        catch (e) { setStatus('Erro: ' + e.message); }
    };

    window.__rcst_auto = async function () {
        setStatus('Procurando páginas...');
        try {
            const urls = await discoverPages();
            discovered = urls.map(u => ({ url: u, checked: true }));
            if (activeTab === 'pages') renderPagesTab();
            await downloadPages(urls);
        } catch (e) { setStatus('Erro: ' + e.message); }
    };

    window.__rcst_toggleDisc = function (i, v) { if (discovered[i]) discovered[i].checked = v; };
    window.__rcst_checkAll = function (v) {
        readCfg();
        discovered.forEach(x => x.checked = v);
        renderPagesTab();
    };

    function renderPagesTab() {
        const chk = v => v ? 'checked' : '';
        let list = discovered.length
            ? discovered.map((x, i) => `<label style="display:block; word-break:break-all;"><input type="checkbox" ${chk(x.checked)} onchange="window.__rcst_toggleDisc(${i}, this.checked)"> ${escapeHtml(x.url)}</label>`).join('')
            : '<i>Nenhuma página listada. Clique em "Procurar páginas".</i>';

        contentDiv.innerHTML = `
            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">💾 Baixar página atual</div>
                <div style="margin-bottom:6px; color:#a6adc8;">
                    <b>Offline</b>: salva o DOM exatamente como está agora (alterações de JS, valores de formulários, canvas, CSS dinâmico), com CSS e imagens embutidos.<br>
                    <b>HTML bruto</b>: salva o DOM atual sem embutir recursos (usa &lt;base&gt; para carregar do site).
                </div>
                <button class="rcst-btn-act" onclick="window.__rcst_savePage(false)">Baixar página (offline)</button>
                <button class="rcst-btn-act" onclick="window.__rcst_savePage(true)">Baixar HTML bruto</button>
            </div>

            <div class="rcst-storage-sec">
                <div class="rcst-storage-title">🕷️ Procurar outras páginas e baixar</div>
                <div class="rcst-input-group">
                    <label>Profundidade <input type="number" id="rcst-cfg-depth" min="0" value="${cfg.depth}" style="width:50px; flex:none;"></label>
                    <label>Máx. páginas <input type="number" id="rcst-cfg-max" min="1" value="${cfg.max}" style="width:60px; flex:none;"></label>
                    <label>Delay (ms) <input type="number" id="rcst-cfg-delay" min="0" value="${cfg.delay}" style="width:60px; flex:none;"></label>
                </div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-cfg-include" value="${escapeHtml(cfg.include)}" placeholder="Incluir somente URLs que casem (regex/texto) — opcional">
                </div>
                <div class="rcst-input-group">
                    <input type="text" id="rcst-cfg-exclude" value="${escapeHtml(cfg.exclude)}" placeholder="Ignorar URLs que casem (regex/texto)">
                </div>
                <div class="rcst-input-group">
                    <label><input type="checkbox" id="rcst-cfg-images" ${chk(cfg.inlineImages)}> embutir imagens</label>
                    <label><input type="checkbox" id="rcst-cfg-scripts" ${chk(cfg.keepScripts)}> manter scripts</label>
                </div>
                <div class="rcst-input-group">
                    <button class="rcst-btn-act" onclick="window.__rcst_discover()">1) Procurar páginas</button>
                    <button class="rcst-btn-act" onclick="window.__rcst_downloadSelected()">2) Baixar selecionadas (ZIP)</button>
                    <button class="rcst-btn-act" style="background:#a6e3a1; color:#11111b;" onclick="window.__rcst_auto()">⚡ Auto: procurar + baixar</button>
                </div>
                <div id="rcst-pages-status" style="color:#f9e2af; margin-bottom:6px;">${escapeHtml(pagesStatus)}</div>
                <div class="rcst-input-group">
                    <button class="rcst-btn-act" onclick="window.__rcst_checkAll(true)">Marcar todas</button>
                    <button class="rcst-btn-act" onclick="window.__rcst_checkAll(false)">Desmarcar todas</button>
                    <span style="color:#a6adc8;">${discovered.length} encontrada(s) — a página atual é sempre incluída</span>
                </div>
                <div class="rcst-args-box" style="max-height:200px;">${list}</div>
            </div>
        `;
    }

    // =====================================================================
    // ABA HOOKS LOCALSTORAGE
    // =====================================================================
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
    window.renderLSHooksTab = renderLSHooksTab; // necessário para os onclick inline

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
    window.renderRulesTab = renderRulesTab; // necessário para os onclick inline

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

    // =====================================================================
    // LOG DE REDE
    // =====================================================================
    function addLogToUI(data) {
        let badgeClass = 'badge-xhr';
        if (data.type.startsWith('fetch')) badgeClass = 'badge-fetch';
        else if (data.type === 'ws-send') badgeClass = 'badge-ws-send';
        else if (data.type === 'ws-recv') badgeClass = 'badge-ws-recv';
        else if (data.type === 'ws-open') badgeClass = 'badge-ws-open';

        const isClickstream = data.url.includes('clickstream');
        if (isClickstream) badgeClass = 'badge-clickstream';
        if (data.replay) badgeClass = 'badge-replay';
        if (data.blocked) badgeClass = 'badge-blocked';

        // guarda a requisição para permitir repetir / editar
        let reqId = -1;
        if (data.type === 'xhr' || data.type === 'fetch') {
            reqId = reqStore.push({
                method: data.method,
                url: data.url,
                headers: data.headers || {},
                body: data.body || ''
            }) - 1;
        }

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
        const replayTag = data.replay ? `<span class="rcst-badge badge-replay">REPLAY</span>` : '';
        const statusTag = data.status ? ` [${data.status}${data.ms ? ' · ' + data.ms + 'ms' : ''}]` : '';

        const replayBtns = reqId >= 0
            ? `<button class="rcst-btn-copy" onclick="window.__rcst_replay(${reqId}, this)">↻ Repetir</button>
               <button class="rcst-btn-copy" onclick="window.__rcst_editReplay(${reqId})">✎ Editar</button>`
            : '';

        const html = `
            <div class="rcst-row-header">
                <div>
                    <span class="rcst-badge ${badgeClass}">${data.blocked ? 'BLOCKED' : (isClickstream ? 'CLICKSTREAM' : (data.method || data.type.toUpperCase()))}</span>
                    ${replayTag}
                    ${modifiedTag}
                    ${blockedTag}
                    <span class="rcst-url">${escapeHtml(data.url)}</span>${statusTag}
                </div>
                <div class="rcst-row-btns">
                    ${replayBtns}
                    <button class="rcst-btn-copy" onclick="window.__rcst_copy(this.getAttribute('data-raw'), this)" data-raw="${rawJsonToCopy}">Copiar Tudo</button>
                </div>
            </div>
            ${argsHtml}
        `;

        logsList.push(html);
        if (logsList.length > 200) logsList.shift();
        if (activeTab === 'logs') render();
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
            addLogToUI({ type: 'xhr', method: d.method, url: d.url, headers: d.headers, body: d.body, status: 0, responseBody: 'Requisição cancelada pelo RCST Inspector', blocked: true });
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
            addLogToUI({ type: 'fetch', method: m, url: d.url, headers: d.headers, body: d.body, status: 0, responseBody: 'Requisição cancelada pelo RCST Inspector', blocked: true });
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

    console.log("[RCST Inspector] Inicializado com sucesso! WebSockets, Replay, Download de página e Crawler ativados.");
})();
