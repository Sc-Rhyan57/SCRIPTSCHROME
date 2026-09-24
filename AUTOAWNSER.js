(function () {
    if (window.__rcst_solver_active) return;
    
    const _defProp = Object.defineProperty;
    _defProp(window, '__rcst_solver_active', { value: true, enumerable: false, configurable: false, writable: false });

    const S = {
        autoMark: localStorage.getItem('__rcst_auto') !== 'false',
        stealthMode: localStorage.getItem('__rcst_stealth') === 'true',
        devMode: localStorage.getItem('__rcst_dev') === 'true',
        dbUrl: localStorage.getItem('__rcst_dbUrl') || 'https://raw.githubusercontent.com/Sc-Rhyan57/SCRIPTSCHROME/refs/heads/main/RESPOSTAS/conhecidas.json',
        githubRepo: localStorage.getItem('__rcst_ghRepo') || 'Sc-Rhyan57/SCRIPTSCHROME',
        githubPath: localStorage.getItem('__rcst_ghPath') || 'RESPOSTAS/conhecidas.json',
        githubToken: localStorage.getItem('__rcst_ghToken') || '',
        aiProvider: localStorage.getItem('__rcst_ai') || 'gemini',
        aiKey: localStorage.getItem('__rcst_key') || '',
        promptTemplate: localStorage.getItem('__rcst_prompt') || 'Analise as questões abaixo. Retorne um array JSON válido. Formato: [{"Question": "texto pergunta", "Anwser": "A", "id": "uuid"}].\n\nQuestões:\n{questions}',
        authToken: '',
        answers: new Map(),
        rawIntercepts: [],
        db: [],
        manualCache: JSON.parse(localStorage.getItem('__rcst_cache') || '[]'),
        observer: null,
        activeTab: 'respostas'
    };

    function stripHtml(html) {
        if (!html) return '';
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent.replace(/\s+/g, ' ').trim();
    }

    function encodeBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
    function decodeBase64(str) { return decodeURIComponent(escape(atob(str))); }

    function processClickstream(bodyStr) {
        try {
            let body = JSON.parse(bodyStr);
            if (body && body.Record && body.Record.Data) {
                let decoded = JSON.parse(decodeBase64(body.Record.Data));
                if ('spent_time' in decoded) {
                    decoded.spent_time = S.stealthMode ? Math.floor(Math.random() * 90) + 30 : 0;
                }
                body.Record.Data = encodeBase64(JSON.stringify(decoded));
                return JSON.stringify(body);
            }
        } catch (e) {}
        return bodyStr;
    }

    const _fetch = window.fetch;
    const _fetchStr = _fetch.toString();
    const hookedFetch = function (input, init) {
        if (init && init.headers) {
            let authHeader = null;
            if (init.headers instanceof Headers) authHeader = init.headers.get('Authorization');
            else if (typeof init.headers === 'object' && init.headers.Authorization) authHeader = init.headers.Authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) S.authToken = authHeader;
        }
        if (typeof input === 'string' && input.includes('clickstream') && init && init.body) {
            init.body = processClickstream(String(init.body));
        }
        return _fetch.call(this, input, init).then(res => {
            if (typeof input === 'string' && input.includes('/api/AlunoAtividades')) {
                const clone = res.clone();
                clone.text().then(txt => {
                    try {
                        const data = JSON.parse(txt);
                        if (data && data.questoes) {
                            S.rawIntercepts.push({ url: input, data });
                            if (S.rawIntercepts.length > 10) S.rawIntercepts.shift();
                            processApiResponse(data);
                        }
                    } catch (e) {}
                });
            }
            return res;
        });
    };
    
    try {
        _defProp(window, 'fetch', { value: hookedFetch, configurable: true, writable: true });
        _defProp(hookedFetch, 'toString', { value: () => _fetchStr, configurable: true, writable: true });
    } catch (e) {}

    const _xhrProto = XMLHttpRequest.prototype;
    const _open = _xhrProto.open;
    const _send = _xhrProto.send;
    const _setHeader = _xhrProto.setRequestHeader;
    
    const _openStr = _open.toString();
    const _sendStr = _send.toString();
    const _setHeaderStr = _setHeader.toString();

    const hookedOpen = function (method, url) { this.__rcst_url = url; return _open.apply(this, arguments); };
    const hookedSetHeader = function (name, val) {
        if (name.toLowerCase() === 'authorization' && val.startsWith('Bearer ')) S.authToken = val;
        return _setHeader.apply(this, arguments);
    };
    const hookedSend = function (body) {
        if (this.__rcst_url && this.__rcst_url.includes('clickstream') && body) {
            let parsedBody = processClickstream(String(body));
            return _send.call(this, parsedBody);
        }
        this.addEventListener('load', function () {
            if (this.__rcst_url && this.__rcst_url.includes('/api/AlunoAtividades')) {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data && data.questoes) {
                        S.rawIntercepts.push({ url: this.__rcst_url, data });
                        if (S.rawIntercepts.length > 10) S.rawIntercepts.shift();
                        processApiResponse(data);
                    }
                } catch (e) {}
            }
        });
        return _send.apply(this, arguments);
    };

    try {
        _defProp(_xhrProto, 'open', { value: hookedOpen, configurable: true, writable: true });
        _defProp(hookedOpen, 'toString', { value: () => _openStr, configurable: true, writable: true });
        
        _defProp(_xhrProto, 'send', { value: hookedSend, configurable: true, writable: true });
        _defProp(hookedSend, 'toString', { value: () => _sendStr, configurable: true, writable: true });
        
        _defProp(_xhrProto, 'setRequestHeader', { value: hookedSetHeader, configurable: true, writable: true });
        _defProp(hookedSetHeader, 'toString', { value: () => _setHeaderStr, configurable: true, writable: true });
    } catch (e) {}

    async function loadDatabase() {
        if (!S.dbUrl) return;
        try {
            const res = await _fetch.call(window, S.dbUrl, { cache: 'no-store' });
            const data = await res.json();
            S.db = Array.isArray(data) ? data : [];
        } catch (e) { S.db = []; }
    }

    function findInDb(q) {
        if (!S.db || S.db.length === 0) return null;
        const byId = S.db.find(e => e.qid === q.id);
        if (byId) return byId;
        const cleanQ = stripHtml(q.conteudo).substring(0, 60).toLowerCase();
        const byText = S.db.find(e => e.q && e.q.toLowerCase().includes(cleanQ));
        return byText || null;
    }

    function matchAlternative(q, dbEntry) {
        if (!dbEntry || !dbEntry.a) return null;
        const targetText = dbEntry.a.toString().toLowerCase();
        let match = q.alternativas.find(alt => alt.id === dbEntry.aid);
        if (match) return match;
        match = q.alternativas.find(alt => stripHtml(alt.conteudo).toLowerCase() === targetText);
        if (match) return match;
        match = q.alternativas.find(alt => stripHtml(alt.conteudo).toLowerCase().includes(targetText));
        return match || null;
    }

    async function callAI(prompt) {
        if (!S.aiKey) return null;
        try {
            let resText = '';
            const openAiFormat = (url, model, key) => _fetch.call(window, url, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], temperature: 0 })
            });
            
            if (S.aiProvider === 'openai') resText = (await (await openAiFormat('https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', S.aiKey)).json()).choices[0].message.content;
            else if (S.aiProvider === 'groq') resText = (await (await openAiFormat('https://api.groq.com/openai/v1/chat/completions', 'llama3-8b-8192', S.aiKey)).json()).choices[0].message.content;
            else if (S.aiProvider === 'deepseek') resText = (await (await openAiFormat('https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', S.aiKey)).json()).choices[0].message.content;
            else if (S.aiProvider === 'mistral') resText = (await (await openAiFormat('https://api.mistral.ai/v1/chat/completions', 'mistral-tiny', S.aiKey)).json()).choices[0].message.content;
            else if (S.aiProvider === 'huggingface') resText = (await (await openAiFormat('https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct/v1', 'meta-llama/Meta-Llama-3-8B-Instruct', S.aiKey)).json()).choices[0].message.content;
            else if (S.aiProvider === 'gemini') {
                const res = await _fetch.call(window, `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${S.aiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                resText = (await res.json()).candidates[0].content.parts[0].text;
            } else if (S.aiProvider === 'claude') {
                const res = await _fetch.call(window, 'https://api.anthropic.com/v1/messages', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': S.aiKey, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
                });
                resText = (await res.json()).content[0].text;
            } else if (S.aiProvider === 'cohere') {
                const res = await _fetch.call(window, 'https://api.cohere.ai/v1/chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.aiKey}` },
                    body: JSON.stringify({ message: prompt, temperature: 0 })
                });
                resText = (await res.json()).text;
            }
            return resText;
        } catch (e) { return null; }
    }

    async function processApiResponse(data) {
        let unanswered = [];
        for (const q of data.questoes) {
            if (S.answers.has(q.id) && S.answers.get(q.id).status !== 'PENDING') continue;
            
            const qText = stripHtml(q.conteudo).substring(0, 60) + '...';
            const qShort = stripHtml(q.conteudo);
            const alts = q.alternativas.map(a => ({ id: a.id, text: stripHtml(a.conteudo) }));
            S.answers.set(q.id, { altId: null, text: 'Aguardando DB/IA...', qText, qShort, alts, status: 'PENDING', raw: q });
            
            const dbEntry = findInDb(q);
            if (dbEntry) {
                const correctAlt = matchAlternative(q, dbEntry);
                if (correctAlt) {
                    S.answers.set(q.id, { altId: correctAlt.id, text: stripHtml(correctAlt.conteudo), qText, qShort, alts, status: 'DB_MATCH', raw: q });
                    continue;
                }
            }
            unanswered.push(q);
        }

        if (unanswered.length > 0 && S.aiKey) {
            unanswered.forEach(q => {
                const ans = S.answers.get(q.id);
                if (ans) { ans.status = 'AI_THINKING'; ans.text = 'IA em lote...'; }
            });
            renderUI();

            const payload = unanswered.map(q => ({ id: q.id, question: stripHtml(q.conteudo), options: q.alternativas.map((a, i) => `${String.fromCharCode(65 + i)}) ${stripHtml(a.conteudo)}`).join('\n') }));
            const prompt = S.promptTemplate.replace(/{questions}/g, JSON.stringify(payload));
            const resText = await callAI(prompt);
            
            if (resText) {
                try {
                    const jsonMatch = resText.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        parsed.forEach(p => {
                            const qId = p.id || p.Question || p.questionId;
                            if (!qId) return;
                            const q = S.answers.get(qId);
                            if (!q) return;
                            const letter = (p.Anwser || p.Answer || p.resposta || p.letra || '').toString().trim().toUpperCase().charAt(0);
                            if (['A','B','C','D','E'].includes(letter)) {
                                const idx = letter.charCodeAt(0) - 65;
                                const alt = q.alts[idx];
                                if (alt) {
                                    S.answers.set(qId, { ...q, altId: alt.id, text: alt.text, status: 'AI_SOLVED' });
                                }
                            }
                        });
                    }
                } catch (e) {}
            }

            unanswered.forEach(q => {
                const ans = S.answers.get(q.id);
                if (ans && ans.status === 'AI_THINKING') {
                    ans.status = 'UNANSWERED';
                    ans.text = 'IA não soube responder';
                }
            });
            renderUI();
            if (S.autoMark) startDomObserver();
        } else if (unanswered.length > 0) {
            unanswered.forEach(q => {
                const ans = S.answers.get(q.id);
                if (ans) { ans.status = 'UNANSWERED'; ans.text = 'Sem IA configurada'; }
            });
            renderUI();
        }
        renderUI();
    }

    function startDomObserver() {
        if (S.observer) return;
        S.observer = new MutationObserver(() => {
            if (!S.autoMark) return;
            S.answers.forEach((ans, qId) => {
                if (ans.marked || !ans.altId || ans.schedulingClick) return;
                let targetEl = document.querySelector(`[id*="${ans.altId}"], [data-id*="${ans.altId}"], [value*="${ans.altId}"], [name*="${ans.altId}"]`);
                if (!targetEl) {
                    document.querySelectorAll('div, label, button, input, span').forEach(el => {
                        if (targetEl) return;
                        if (el.innerHTML.includes(ans.altId) || el.getAttribute('data-alternativa-id') === ans.altId) targetEl = el;
                    });
                }
                if (targetEl) {
                    ans.schedulingClick = true;
                    let delay = S.stealthMode ? (Math.floor(Math.random() * 10) + 5) * 1000 : 0;
                    setTimeout(() => {
                        targetEl.click();
                        if (targetEl.querySelector('input')) targetEl.querySelector('input').click();
                        ans.marked = true;
                        renderUI();
                    }, delay);
                }
            });
        });
        S.observer.observe(document.body, { childList: true, subtree: true });
    }

    function manualAnswer(qId, altId) {
        const ans = S.answers.get(qId);
        if (!ans) return;
        const alt = ans.alts.find(a => a.id === altId);
        if (!alt) return;
        ans.altId = alt.id;
        ans.text = alt.text;
        ans.status = 'MANUAL';
        ans.marked = false;
        S.manualCache = S.manualCache.filter(c => c.qid !== qId);
        S.manualCache.push({ qid: qId, q: ans.qShort, aid: alt.id, a: alt.text });
        localStorage.setItem('__rcst_cache', JSON.stringify(S.manualCache));
        if (S.autoMark) startDomObserver();
        renderUI();
    }

    async function commitToGithub() {
        if (!S.githubToken || !S.githubRepo || !S.githubPath) return alert('Configure o Token e Repositório do GitHub nas Configurações.');
        const apiUrl = `https://api.github.com/repos/${S.githubRepo}/contents/${S.githubPath}`;
        try {
            const getRes = await _fetch.call(window, apiUrl, { headers: { Authorization: `token ${S.githubToken}`, Accept: 'application/vnd.github.v3+json' } });
            if (!getRes.ok) throw new Error('Falha ao buscar arquivo no GitHub');
            const getData = await getRes.json();
            const sha = getData.sha;
            const content = decodeBase64(getData.content.replace(/\n/g, ''));
            let db = JSON.parse(content || '[]');
            S.manualCache.forEach(cacheItem => {
                const idx = db.findIndex(d => d.qid === cacheItem.qid);
                if (idx !== -1) db[idx] = cacheItem; else db.push(cacheItem);
            });
            const newContent = encodeBase64(JSON.stringify(db, null, 2));
            const putRes = await _fetch.call(window, apiUrl, {
                method: 'PUT',
                headers: { Authorization: `token ${S.githubToken}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: '[ RCST ] Adicionando novas questões para database via api.', content: newContent, sha: sha })
            });
            if (putRes.ok) {
                alert('Commitado no GitHub com sucesso!');
                S.manualCache = [];
                localStorage.setItem('__rcst_cache', '[]');
                await loadDatabase();
                renderUI();
            } else {
                const errData = await putRes.json();
                alert('Erro ao commitar: ' + errData.message);
            }
        } catch (e) { alert('Erro GitHub: ' + e.message); }
    }

    async function forceFetchActivity() {
        if (!S.authToken) return alert('Token de acesso não encontrado. Navegue no site primeiro.');
        let activityId = prompt('Digite o ID da atividade para forçar o fetch:');
        if (!activityId) return;
        try {
            const res = await _fetch.call(window, `https://questoes.sedu.es.gov.br/api/AlunoAtividades/${activityId}`, {
                headers: { 'Authorization': S.authToken, 'Accept': 'application/json, text/plain, */*' }
            });
            const data = await res.json();
            if (data && data.questoes) {
                S.rawIntercepts.push({ url: `Forçado: ${activityId}`, data });
                if (S.rawIntercepts.length > 10) S.rawIntercepts.shift();
                processApiResponse(data);
                alert('Atividade extraída com sucesso!');
            } else {
                alert('Resposta inválida ou atividade não encontrada.');
            }
        } catch (e) { alert('Erro ao forçar fetch: ' + e.message); }
    }

    function extractDOM() {
        const main = document.querySelector('main, app-root, body');
        if (!main) return alert('Estrutura HTML não encontrada.');
        const html = main.innerHTML;
        S.rawIntercepts.push({ url: 'DOM_EXTRACTION', data: { html: html.substring(0, 5000) + '...' } });
        if (S.rawIntercepts.length > 10) S.rawIntercepts.shift();
        renderUI();
        alert('HTML do DOM extraído e salvo na aba Dev Tools!');
    }

    function buildUI() {
        const ui = document.createElement('div');
        ui.id = 'rcst-solver-panel';
        ui.style.cssText = 'position: fixed; top: 10px; right: 10px; width: 450px; height: 600px; background: #0d1117; color: #c9d1d9; font-family: Segoe UI, sans-serif; font-size: 12px; z-index: 9999999; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.9); display: flex; flex-direction: column; border: 1px solid #30363d; overflow: hidden; transition: height 0.3s ease;';
        
        const style = document.createElement('style');
        style.textContent = `
            #rcst-solver-panel.minimized { height: 38px; }
            #rcst-solver-header { background: #161b22; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; border-bottom: 1px solid #30363d; }
            #rcst-solver-title { font-weight: bold; color: #58a6ff; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; }
            #rcst-solver-controls { display: flex; gap: 8px; }
            .rcst-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold; transition: 0.2s; text-decoration: none; display: inline-block; }
            .rcst-btn:hover { background: #30363d; border-color: #8b949e; }
            .rcst-btn.active { background: #238636; border-color: #2ea043; color: #fff; }
            .rcst-btn.stealth-active { background: #a371f7; border-color: #bc8cff; color: #fff; }
            .rcst-tab { background: transparent; border: none; color: #8b949e; padding: 8px 12px; cursor: pointer; font-size: 11px; font-weight: bold; border-bottom: 2px solid transparent; }
            .rcst-tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
            #rcst-tabs { display: flex; background: #0d1117; border-bottom: 1px solid #30363d; }
            #rcst-content { flex: 1; overflow-y: auto; padding: 8px; }
            #rcst-content::-webkit-scrollbar { width: 6px; }
            #rcst-content::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
            .rcst-item { background: #161b22; margin-bottom: 8px; padding: 10px; border-radius: 8px; border-left: 4px solid #f85149; transition: 0.3s; }
            .rcst-item.marked { border-left-color: #2ea043; opacity: 0.7; }
            .rcst-item.unanswered { border-left-color: #d29922; }
            .rcst-q { color: #8b949e; margin-bottom: 4px; font-size: 11px; }
            .rcst-a { color: #fff; font-weight: bold; display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
            .rcst-badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: #58a6ff; color: #000; font-weight: bold; }
            .rcst-badge.ai { background: #bc8cff; }
            .rcst-badge.failed { background: #f85149; color: #fff; }
            .rcst-badge.pending { background: #d29922; color: #000; }
            .rcst-badge.manual { background: #3fb950; color: #fff; }
            .rcst-alt-btn { display: block; width: 100%; text-align: left; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px; }
            .rcst-alt-btn:hover { background: #21262d; border-color: #58a6ff; }
            .rcst-config { display: flex; flex-direction: column; gap: 12px; padding: 10px; }
            .rcst-field { display: flex; flex-direction: column; gap: 4px; }
            .rcst-field label { font-size: 10px; color: #8b949e; text-transform: uppercase; }
            .rcst-field input, .rcst-field select, .rcst-field textarea { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; resize: vertical; }
            .rcst-raw { background: #010409; border: 1px solid #21262d; border-radius: 6px; padding: 8px; color: #7d8590; font-size: 10px; white-space: pre-wrap; word-break: break-all; margin-bottom: 8px; max-height: 200px; overflow-y: auto; }
            .rcst-id { color: #a371f7; font-size: 9px; margin-top: 4px; }
            .rcst-actions { display: flex; gap: 8px; margin-top: 4px; }
        `;
        document.head.appendChild(style);

        ui.innerHTML = `
            <div id="rcst-solver-header">
                <div id="rcst-solver-title">⚡ RCST Dev Solver</div>
                <div id="rcst-solver-controls">
                    <button id="rcst-btn-stealth" class="rcst-btn ${S.stealthMode ? 'stealth-active' : ''}">STEALTH</button>
                    <button id="rcst-btn-dev" class="rcst-btn ${S.devMode ? 'active' : ''}">DEV</button>
                    <button id="rcst-btn-auto" class="rcst-btn ${S.autoMark ? 'active' : ''}">AUTO</button>
                    <button id="rcst-btn-min" class="rcst-btn">—</button>
                </div>
            </div>
            <div id="rcst-tabs">
                <button class="rcst-tab active" data-tab="respostas">Respostas</button>
                <button class="rcst-tab" data-tab="dev">Dev Tools</button>
                <button class="rcst-tab" data-tab="config">Config</button>
            </div>
            <div id="rcst-content"></div>
        `;
        document.body.appendChild(ui);

        document.getElementById('rcst-btn-stealth').addEventListener('click', (e) => {
            S.stealthMode = !S.stealthMode;
            localStorage.setItem('__rcst_stealth', S.stealthMode);
            e.target.classList.toggle('stealth-active', S.stealthMode);
            alert('Modo Sorrateiro ' + (S.stealthMode ? 'ATIVADO' : 'DESATIVADO'));
        });
        document.getElementById('rcst-btn-dev').addEventListener('click', (e) => {
            S.devMode = !S.devMode;
            localStorage.setItem('__rcst_dev', S.devMode);
            e.target.classList.toggle('active', S.devMode);
            renderUI();
        });
        document.getElementById('rcst-btn-auto').addEventListener('click', (e) => {
            S.autoMark = !S.autoMark;
            localStorage.setItem('__rcst_auto', S.autoMark);
            e.target.classList.toggle('active', S.autoMark);
            if (S.autoMark) startDomObserver(); else if (S.observer) { S.observer.disconnect(); S.observer = null; }
        });
        document.getElementById('rcst-btn-min').addEventListener('click', () => ui.classList.toggle('minimized'));
        document.querySelectorAll('.rcst-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rcst-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                S.activeTab = btn.dataset.tab;
                renderUI();
            });
        });

        const header = document.getElementById('rcst-solver-header');
        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - ui.offsetLeft;
            offsetY = e.clientY - ui.offsetTop;
        });
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                ui.style.left = (e.clientX - offsetX) + 'px';
                ui.style.top = (e.clientY - offsetY) + 'px';
                ui.style.right = 'auto';
                ui.style.bottom = 'auto';
            }
        });
        document.addEventListener('mouseup', () => isDragging = false);
    }

    function renderUI() {
        if (!document.getElementById('rcst-solver-panel')) buildUI();
        const content = document.getElementById('rcst-content');
        
        if (S.activeTab === 'respostas') {
            if (S.answers.size === 0) {
                content.innerHTML = '<div style="text-align:center; padding:20px; color:#8b949e;">Aguardando interceptação de questões...</div>';
                return;
            }
            content.innerHTML = '';
            S.answers.forEach((ans, qId) => {
                let badge = '';
                if (ans.status === 'DB_MATCH') badge = '<span class="rcst-badge">DB</span>';
                else if (ans.status === 'AI_SOLVED') badge = '<span class="rcst-badge ai">IA</span>';
                else if (ans.status === 'MANUAL') badge = '<span class="rcst-badge manual">MANUAL</span>';
                else if (ans.status === 'AI_THINKING' || ans.status === 'PENDING') badge = '<span class="rcst-badge pending">AGUARD</span>';
                else if (ans.status === 'UNANSWERED' || ans.status === 'NO_ANSWER' || ans.status === 'FAILED') badge = '<span class="rcst-badge failed">PENDENTE</span>';
                
                const isUnanswered = ans.status === 'UNANSWERED' || ans.status === 'FAILED';
                const item = document.createElement('div');
                item.className = 'rcst-item' + (ans.marked ? ' marked' : '') + (isUnanswered ? ' unanswered' : '');
                
                let html = `<div class="rcst-q">${ans.qText}</div><div class="rcst-a">${badge} ${ans.text}</div>`;
                
                if (isUnanswered) {
                    let googleQ = encodeURIComponent(ans.qShort + ' ' + ans.alts.map(a => a.text).join(' '));
                    html += `<div class="rcst-actions"><a href="https://www.google.com/search?q=${googleQ}" target="_blank" class="rcst-btn">🔍 Google</a></div>`;
                    
                    if (S.devMode) {
                        html += '<div style="margin-top:8px; border-top:1px dashed #30363d; padding-top:8px;">';
                        ans.alts.forEach(alt => {
                            html += `<button class="rcst-alt-btn" data-qid="${qId}" data-aid="${alt.id}">${alt.text}</button>`;
                        });
                        html += '</div>';
                    }
                }
                
                if (S.devMode && ans.raw) {
                    html += `<div class="rcst-id">QID: ${ans.raw.id}</div>`;
                    if (ans.altId) html += `<div class="rcst-id">AID: ${ans.altId}</div>`;
                }
                
                item.innerHTML = html;
                content.appendChild(item);
            });
            content.querySelectorAll('.rcst-alt-btn').forEach(btn => {
                btn.addEventListener('click', () => manualAnswer(btn.dataset.qid, btn.dataset.aid));
            });
        } else if (S.activeTab === 'dev') {
            let html = `<div style="display:flex; gap:8px; margin-bottom:10px;">
                <button id="rcst-btn-force" class="rcst-btn" style="flex:1;">Force Fetch Activity</button>
                <button id="rcst-btn-dom" class="rcst-btn" style="flex:1;">Extract DOM HTML</button>
            </div>`;
            html += `<button id="rcst-btn-commit" class="rcst-btn" style="width:100%; margin-bottom:10px;">🚀 Commit Cache no GitHub (${S.manualCache.length})</button>`;
            html += `<div style="margin-bottom:10px;"><strong>Token Extraído:</strong> <span style="color:#58a6ff;">${S.authToken ? 'Ativo' : 'Aguardando'}</span></div>`;
            html += `<div style="margin-bottom:10px;"><strong>Cache Local (Não Commitado):</strong></div>`;
            if (S.manualCache.length === 0) html += '<div style="color:#8b949e; margin-bottom:10px;">Nenhum item no cache.</div>';
            else {
                S.manualCache.forEach(c => { html += `<div class="rcst-raw">${JSON.stringify(c)}</div>`; });
            }
            html += `<div style="margin-top:15px; border-top:1px solid #30363d; padding-top:10px;"><strong>Interceptações Brutas (API/DOM):</strong></div>`;
            if (S.rawIntercepts.length === 0) html += '<div style="color:#8b949e;">Nenhuma interceptação.</div>';
            else {
                S.rawIntercepts.forEach((r, i) => { html += `<div class="rcst-raw">[${i}] URL: ${r.url}\n\n${JSON.stringify(r.data).substring(0, 1000)}...</div>`; });
            }
            content.innerHTML = html;
            document.getElementById('rcst-btn-force').addEventListener('click', forceFetchActivity);
            document.getElementById('rcst-btn-dom').addEventListener('click', extractDOM);
            document.getElementById('rcst-btn-commit').addEventListener('click', commitToGithub);
        } else if (S.activeTab === 'config') {
            content.innerHTML = `
                <div class="rcst-config">
                    <div class="rcst-field"><label>Database URL (JSON Raw)</label><input type="text" id="cfg-dbUrl" value="${S.dbUrl}"></div>
                    <div class="rcst-field"><label>GitHub Repo (Owner/Repo)</label><input type="text" id="cfg-ghRepo" value="${S.githubRepo}"></div>
                    <div class="rcst-field"><label>GitHub Path (Ex: pasta/arquivo.json)</label><input type="text" id="cfg-ghPath" value="${S.githubPath}"></div>
                    <div class="rcst-field"><label>GitHub Token (PAT)</label><input type="password" id="cfg-ghToken" value="${S.githubToken}" placeholder="ghp_..."></div>
                    <div class="rcst-field">
                        <label>Provedor de IA</label>
                        <select id="cfg-aiProvider">
                            <option value="gemini" ${S.aiProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                            <option value="openai" ${S.aiProvider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4o)</option>
                            <option value="claude" ${S.aiProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
                            <option value="groq" ${S.aiProvider === 'groq' ? 'selected' : ''}>Groq (Llama 3)</option>
                            <option value="deepseek" ${S.aiProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                            <option value="mistral" ${S.aiProvider === 'mistral' ? 'selected' : ''}>Mistral AI</option>
                            <option value="cohere" ${S.aiProvider === 'cohere' ? 'selected' : ''}>Cohere</option>
                            <option value="huggingface" ${S.aiProvider === 'huggingface' ? 'selected' : ''}>HuggingFace</option>
                        </select>
                    </div>
                    <div class="rcst-field"><label>IA API Key</label><input type="password" id="cfg-aiKey" value="${S.aiKey}"></div>
                    <div class="rcst-field"><label>Prompt Customizado (Variável: {questions})</label><textarea id="cfg-promptTemplate" rows="6">${S.promptTemplate}</textarea></div>
                    <button id="rcst-btn-save" class="rcst-btn active" style="margin-top:10px;">SALVAR TUDO</button>
                </div>
            `;
            document.getElementById('rcst-btn-save').addEventListener('click', () => {
                S.dbUrl = document.getElementById('cfg-dbUrl').value || S.dbUrl;
                S.githubRepo = document.getElementById('cfg-ghRepo').value || S.githubRepo;
                S.githubPath = document.getElementById('cfg-ghPath').value || S.githubPath;
                S.githubToken = document.getElementById('cfg-ghToken').value || S.githubToken;
                S.aiProvider = document.getElementById('cfg-aiProvider').value || S.aiProvider;
                S.aiKey = document.getElementById('cfg-aiKey').value || S.aiKey;
                S.promptTemplate = document.getElementById('cfg-promptTemplate').value || S.promptTemplate;
                localStorage.setItem('__rcst_dbUrl', S.dbUrl);
                localStorage.setItem('__rcst_ghRepo', S.githubRepo);
                localStorage.setItem('__rcst_ghPath', S.githubPath);
                localStorage.setItem('__rcst_ghToken', S.githubToken);
                localStorage.setItem('__rcst_ai', S.aiProvider);
                localStorage.setItem('__rcst_key', S.aiKey);
                localStorage.setItem('__rcst_prompt', S.promptTemplate);
                loadDatabase();
                alert('Salvo!');
            });
        }
    }

    buildUI();
    renderUI();
    loadDatabase();
})();
