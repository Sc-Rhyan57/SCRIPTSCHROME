(function () {
    if (window.__rcst_solver_active) return;
    window.__rcst_solver_active = true;

    const S = {
        autoMark: localStorage.getItem('__rcst_auto') !== 'false',
        dbUrl: localStorage.getItem('__rcst_dbUrl') || 'https://raw.githubusercontent.com/Sc-Rhyan57/SCRIPTSCHROME/refs/heads/main/RESPOSTAS/conhecidas.json',
        aiProvider: localStorage.getItem('__rcst_ai') || 'gemini',
        aiKey: localStorage.getItem('__rcst_key') || '',
        answers: new Map(),
        db: [],
        observer: null,
        activeTab: 'respostas'
    };

    const oFetch = window.fetch;
    window.fetch = function (input, init) {
        return oFetch.call(this, input, init).then(res => {
            if (typeof input === 'string' && input.includes('/api/AlunoAtividades')) {
                const clone = res.clone();
                clone.text().then(txt => {
                    try {
                        const data = JSON.parse(txt);
                        if (data && data.questoes) processApiResponse(data);
                    } catch (e) {}
                });
            }
            return res;
        });
    };

    const oXHROpen = XMLHttpRequest.prototype.open;
    const oXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__rcst_url = url;
        return oXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', function () {
            if (this.__rcst_url && this.__rcst_url.includes('/api/AlunoAtividades')) {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data && data.questoes) processApiResponse(data);
                } catch (e) {}
            }
        });
        return oXHRSend.apply(this, arguments);
    };

    function stripHtml(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent.replace(/\s+/g, ' ').trim();
    }

    async function loadDatabase() {
        if (!S.dbUrl) return;
        try {
            const res = await oFetch.call(window, S.dbUrl);
            const data = await res.json();
            S.db = Array.isArray(data) ? data : [];
        } catch (e) {
            S.db = [];
        }
    }

    function findInDb(qText) {
        if (!S.db || S.db.length === 0) return null;
        const cleanQ = qText.substring(0, 60).toLowerCase();
        for (let i = 0; i < S.db.length; i++) {
            const entry = S.db[i];
            if (entry.q && entry.q.toLowerCase().includes(cleanQ) && entry.a) {
                return entry.a.toString().trim();
            }
        }
        return null;
    }

    async function askAI(q) {
        if (!S.aiKey) return -1;
        const qText = stripHtml(q.conteudo);
        const optionsText = q.alternativas.map((a, i) => `${String.fromCharCode(65 + i)}) ${stripHtml(a.conteudo)}`).join('\n');
        const prompt = `Você é um especialista em questões de múltipla escolha. Responda apenas com a LETRA da alternativa correta (A, B, C, D ou E).\n\nPergunta: ${qText}\n\nAlternativas:\n${optionsText}\n\nResposta:`;
        
        try {
            let resText = '';
            if (S.aiProvider === 'openai') {
                const res = await oFetch.call(window, 'https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.aiKey}` },
                    body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], temperature: 0 })
                });
                const data = await res.json();
                resText = data.choices[0].message.content;
            } else if (S.aiProvider === 'gemini') {
                const res = await oFetch.call(window, `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${S.aiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                resText = data.candidates[0].content.parts[0].text;
            } else if (S.aiProvider === 'claude') {
                const res = await oFetch.call(window, 'https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': S.aiKey, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 10, messages: [{ role: 'user', content: prompt }] })
                });
                const data = await res.json();
                resText = data.content[0].text;
            }
            
            const letter = resText.trim().toUpperCase().charAt(0);
            if (['A', 'B', 'C', 'D', 'E'].includes(letter)) return letter.charCodeAt(0) - 65;
            return -1;
        } catch (e) {
            return -1;
        }
    }

    async function processApiResponse(data) {
        for (const q of data.questoes) {
            if (S.answers.has(q.id)) continue;
            
            const qText = stripHtml(q.conteudo).substring(0, 50) + '...';
            S.answers.set(q.id, { altId: null, text: 'Processando...', qText, status: 'PENDING' });
            renderUI();

            let correctAlt = null;
            let status = 'NO_ANSWER';

            const expectedAnswer = findInDb(stripHtml(q.conteudo));
            if (expectedAnswer) {
                correctAlt = q.alternativas.find(alt => {
                    const altText = stripHtml(alt.conteudo).toLowerCase();
                    return altText === expectedAnswer.toLowerCase() || altText.includes(expectedAnswer.toLowerCase()) || expectedAnswer.toLowerCase().includes(altText);
                });
                if (correctAlt) status = 'DB_MATCH';
            }

            if (!correctAlt) {
                status = 'AI_THINKING';
                S.answers.set(q.id, { altId: null, text: 'IA Pensando...', qText, status });
                renderUI();
                
                const aiIndex = await askAI(q);
                if (aiIndex !== -1) {
                    correctAlt = q.alternativas[aiIndex];
                    status = 'AI_SOLVED';
                } else {
                    status = 'FAILED';
                }
            }

            if (correctAlt) {
                const aText = stripHtml(correctAlt.conteudo);
                S.answers.set(q.id, { altId: correctAlt.id, text: aText, qText, status });
                if (S.autoMark) startDomObserver();
            } else if (status === 'FAILED') {
                S.answers.set(q.id, { altId: null, text: 'Sem resposta/Erro IA', qText, status });
            }
            renderUI();
        }
    }

    function startDomObserver() {
        if (S.observer) return;
        S.observer = new MutationObserver(() => {
            if (!S.autoMark) return;
            S.answers.forEach((ans, qId) => {
                if (ans.marked || !ans.altId) return;
                
                let targetEl = document.querySelector(`[id*="${ans.altId}"], [data-id*="${ans.altId}"], [value*="${ans.altId}"], [name*="${ans.altId}"]`);
                
                if (!targetEl) {
                    const allElements = document.querySelectorAll('div, label, button, input, span');
                    for (let el of allElements) {
                        if (el.innerHTML.includes(ans.altId) || el.getAttribute('data-alternativa-id') === ans.altId) {
                            targetEl = el;
                            break;
                        }
                    }
                }

                if (targetEl) {
                    targetEl.click();
                    if (targetEl.querySelector('input')) targetEl.querySelector('input').click();
                    ans.marked = true;
                    renderUI();
                }
            });
        });
        S.observer.observe(document.body, { childList: true, subtree: true });
    }

    function buildUI() {
        const ui = document.createElement('div');
        ui.id = 'rcst-solver-panel';
        ui.innerHTML = `
            <style>
                #rcst-solver-panel { position: fixed; top: 10px; right: 10px; width: 420px; height: 550px; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; font-size: 12px; z-index: 9999999; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.9); display: flex; flex-direction: column; border: 1px solid #30363d; overflow: hidden; transition: height 0.3s ease; }
                #rcst-solver-panel.minimized { height: 38px; }
                #rcst-solver-header { background: #161b22; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; border-bottom: 1px solid #30363d; }
                #rcst-solver-title { font-weight: bold; color: #58a6ff; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; }
                #rcst-solver-controls { display: flex; gap: 8px; }
                .rcst-solver-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold; transition: 0.2s; }
                .rcst-solver-btn:hover { background: #30363d; border-color: #8b949e; }
                .rcst-solver-btn.active { background: #238636; border-color: #2ea043; color: #fff; }
                .rcst-solver-tab { background: transparent; border: none; color: #8b949e; padding: 8px 12px; cursor: pointer; font-size: 11px; font-weight: bold; border-bottom: 2px solid transparent; }
                .rcst-solver-tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
                #rcst-solver-tabs { display: flex; background: #0d1117; border-bottom: 1px solid #30363d; }
                #rcst-solver-content { flex: 1; overflow-y: auto; padding: 8px; }
                #rcst-solver-content::-webkit-scrollbar { width: 6px; }
                #rcst-solver-content::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
                .rcst-solver-item { background: #161b22; margin-bottom: 8px; padding: 10px; border-radius: 8px; border-left: 4px solid #f85149; transition: 0.3s; }
                .rcst-solver-item.marked { border-left-color: #2ea043; opacity: 0.7; }
                .rcst-solver-q { color: #8b949e; margin-bottom: 4px; font-size: 11px; }
                .rcst-solver-a { color: #fff; font-weight: bold; display: flex; align-items: center; gap: 5px; }
                .rcst-solver-badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: #58a6ff; color: #000; font-weight: bold; }
                .rcst-solver-badge.ai { background: #bc8cff; }
                .rcst-solver-badge.failed { background: #f85149; color: #fff; }
                .rcst-solver-badge.pending { background: #d29922; color: #000; }
                .rcst-solver-config { display: flex; flex-direction: column; gap: 12px; padding: 10px; }
                .rcst-solver-field { display: flex; flex-direction: column; gap: 4px; }
                .rcst-solver-field label { font-size: 10px; color: #8b949e; text-transform: uppercase; }
                .rcst-solver-field input, .rcst-solver-field select { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; }
                .rcst-solver-save { margin-top: 10px; background: #238636; border: 1px solid #2ea043; color: #fff; padding: 8px; border-radius: 6px; font-weight: bold; cursor: pointer; }
            </style>
            <div id="rcst-solver-header">
                <div id="rcst-solver-title">⚡ RCST Advanced Solver</div>
                <div id="rcst-solver-controls">
                    <button id="rcst-solver-auto" class="rcst-solver-btn ${S.autoMark ? 'active' : ''}">AUTO</button>
                    <button id="rcst-solver-min" class="rcst-solver-btn">—</button>
                </div>
            </div>
            <div id="rcst-solver-tabs">
                <button class="rcst-solver-tab active" data-tab="respostas">Respostas</button>
                <button class="rcst-solver-tab" data-tab="config">Configurações</button>
            </div>
            <div id="rcst-solver-content"></div>
        `;
        document.body.appendChild(ui);

        document.getElementById('rcst-solver-auto').addEventListener('click', (e) => {
            S.autoMark = !S.autoMark;
            localStorage.setItem('__rcst_auto', S.autoMark);
            e.target.classList.toggle('active', S.autoMark);
            if (S.autoMark) startDomObserver(); else if (S.observer) { S.observer.disconnect(); S.observer = null; }
        });

        document.getElementById('rcst-solver-min').addEventListener('click', () => {
            ui.classList.toggle('minimized');
        });

        document.querySelectorAll('.rcst-solver-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rcst-solver-tab').forEach(b => b.classList.remove('active'));
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
        const content = document.getElementById('rcst-solver-content');
        
        if (S.activeTab === 'respostas') {
            if (S.answers.size === 0) {
                content.innerHTML = '<div style="text-align:center; padding:20px; color:#8b949e;">Aguardando interceptação de questões do servidor...</div>';
                return;
            }
            content.innerHTML = '';
            S.answers.forEach((ans, qId) => {
                let badge = '';
                if (ans.status === 'DB_MATCH') badge = '<span class="rcst-solver-badge">DB</span>';
                else if (ans.status === 'AI_SOLVED') badge = '<span class="rcst-solver-badge ai">IA</span>';
                else if (ans.status === 'AI_THINKING' || ans.status === 'PENDING') badge = '<span class="rcst-solver-badge pending">AGUARD</span>';
                else if (ans.status === 'FAILED' || ans.status === 'NO_ANSWER') badge = '<span class="rcst-solver-badge failed">FALHOU</span>';
                
                const item = document.createElement('div');
                item.className = 'rcst-solver-item' + (ans.marked ? ' marked' : '');
                item.innerHTML = `
                    <div class="rcst-solver-q">${ans.qText}</div>
                    <div class="rcst-solver-a">
                        ${badge}
                        ${ans.text}
                    </div>
                `;
                content.appendChild(item);
            });
        } else if (S.activeTab === 'config') {
            content.innerHTML = `
                <div class="rcst-solver-config">
                    <div class="rcst-solver-field">
                        <label>Database URL (JSON no GitHub)</label>
                        <input type="text" id="rcst-db-url" value="${S.dbUrl}" placeholder="https://raw.githubusercontent.com/...">
                    </div>
                    <div class="rcst-solver-field">
                        <label>Provedor de IA</label>
                        <select id="rcst-ai-provider">
                            <option value="gemini" ${S.aiProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                            <option value="openai" ${S.aiProvider === 'openai' ? 'selected' : ''}>OpenAI (ChatGPT)</option>
                            <option value="claude" ${S.aiProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
                        </select>
                    </div>
                    <div class="rcst-solver-field">
                        <label>API Key da IA</label>
                        <input type="password" id="rcst-ai-key" value="${S.aiKey}" placeholder="Cole sua chave aqui">
                    </div>
                    <button class="rcst-solver-save" id="rcst-save-config">SALVAR E APLICAR</button>
                </div>
            `;
            
            document.getElementById('rcst-save-config').addEventListener('click', () => {
                S.dbUrl = document.getElementById('rcst-db-url').value;
                S.aiProvider = document.getElementById('rcst-ai-provider').value;
                S.aiKey = document.getElementById('rcst-ai-key').value;
                localStorage.setItem('__rcst_dbUrl', S.dbUrl);
                localStorage.setItem('__rcst_ai', S.aiProvider);
                localStorage.setItem('__rcst_key', S.aiKey);
                loadDatabase();
                alert('Configurações salvas!');
            });
        }
    }

    buildUI();
    renderUI();
    loadDatabase();
})();
