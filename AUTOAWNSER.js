(function () {
    if (window.__rcst_solver_active) return;
    window.__rcst_solver_active = true;

    const solverState = {
        interceptActive: true,
        autoMarkActive: true,
        correctAnswers: new Map(),
        panel: null,
        observer: null
    };

    const oFetch = window.fetch;
    window.fetch = function (input, init) {
        return oFetch.call(this, input, init).then(res => {
            if (solverState.interceptActive && typeof input === 'string' && input.includes('/api/AlunoAtividades')) {
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
            if (solverState.interceptActive && this.__rcst_url && this.__rcst_url.includes('/api/AlunoAtividades')) {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data && data.questoes) processApiResponse(data);
                } catch (e) {}
            }
        });
        return oXHRSend.apply(this, arguments);
    };

    function processApiResponse(data) {
        let newAnswers = false;
        data.questoes.forEach(q => {
            if (!solverState.correctAnswers.has(q.id)) {
                const correctAlt = q.alternativas.find(a => a.correta);
                if (correctAlt) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = q.conteudo;
                    const qText = tempDiv.textContent.substring(0, 50).trim() + '...';
                    tempDiv.innerHTML = correctAlt.conteudo;
                    const aText = tempDiv.textContent.trim();
                    
                    solverState.correctAnswers.set(q.id, {
                        questionId: q.id,
                        correctAltId: correctAlt.id,
                        questionText: qText,
                        answerText: aText,
                        marked: false
                    });
                    newAnswers = true;
                }
            }
        });

        if (newAnswers) {
            renderMenu();
            if (solverState.autoMarkActive) startDomObserver();
        }
    }

    function startDomObserver() {
        if (solverState.observer) return;
        solverState.observer = new MutationObserver(() => {
            if (!solverState.autoMarkActive) return;
            solverState.correctAnswers.forEach((ans, qId) => {
                if (ans.marked) return;
                
                let targetEl = document.querySelector(`[data-id*="${ans.correctAltId}"], [id*="${ans.correctAltId}"], [value*="${ans.correctAltId}"], [name*="${ans.correctAltId}"]`);
                
                if (!targetEl) {
                    const allElements = document.querySelectorAll('div, label, button, input, span');
                    for (let el of allElements) {
                        if (el.innerHTML.includes(ans.correctAltId) || el.getAttribute('data-alternativa-id') === ans.correctAltId) {
                            targetEl = el;
                            break;
                        }
                    }
                }

                if (targetEl) {
                    targetEl.click();
                    if (targetEl.querySelector('input')) targetEl.querySelector('input').click();
                    ans.marked = true;
                    renderMenu();
                }
            });
        });
        solverState.observer.observe(document.body, { childList: true, subtree: true });
    }

    function buildUI() {
        const ui = document.createElement('div');
        ui.id = 'rcst-solver-panel';
        ui.innerHTML = `
            <style>
                #rcst-solver-panel { position: fixed; top: 10px; right: 10px; width: 380px; height: 500px; background: #0f0f1a; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; font-size: 12px; z-index: 9999999; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.8); display: flex; flex-direction: column; border: 1px solid #2a2a40; overflow: hidden; transition: height 0.3s ease; }
                #rcst-solver-panel.minimized { height: 38px; }
                #rcst-solver-header { background: linear-gradient(90deg, #1a1a2e, #16213e); padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; border-bottom: 1px solid #2a2a40; }
                #rcst-solver-title { font-weight: bold; color: #00d4ff; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; }
                #rcst-solver-controls { display: flex; gap: 8px; }
                .rcst-solver-btn { background: #2a2a40; border: none; color: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold; transition: 0.2s; }
                .rcst-solver-btn:hover { background: #00d4ff; color: #000; }
                .rcst-solver-btn.active { background: #28a745; color: #fff; }
                #rcst-solver-content { flex: 1; overflow-y: auto; padding: 8px; }
                #rcst-solver-content::-webkit-scrollbar { width: 6px; }
                #rcst-solver-content::-webkit-scrollbar-thumb { background: #00d4ff; border-radius: 3px; }
                .rcst-solver-item { background: #1a1a2e; margin-bottom: 8px; padding: 10px; border-radius: 8px; border-left: 4px solid #dc3545; transition: 0.3s; }
                .rcst-solver-item.marked { border-left-color: #28a745; opacity: 0.6; }
                .rcst-solver-q { color: #a0a0a0; margin-bottom: 4px; font-size: 11px; }
                .rcst-solver-a { color: #fff; font-weight: bold; display: flex; align-items: center; gap: 5px; }
                .rcst-solver-badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: #28a745; color: #fff; }
                .rcst-solver-badge.pending { background: #ffc107; color: #000; }
            </style>
            <div id="rcst-solver-header">
                <div id="rcst-solver-title">⚡ RCST Solver</div>
                <div id="rcst-solver-controls">
                    <button id="rcst-solver-auto" class="rcst-solver-btn active">AUTO</button>
                    <button id="rcst-solver-min" class="rcst-solver-btn">—</button>
                </div>
            </div>
            <div id="rcst-solver-content"></div>
        `;
        document.body.appendChild(ui);
        solverState.panel = ui;

        document.getElementById('rcst-solver-auto').addEventListener('click', (e) => {
            solverState.autoMarkActive = !solverState.autoMarkActive;
            e.target.classList.toggle('active', solverState.autoMarkActive);
            if (solverState.autoMarkActive) startDomObserver(); else if (solverState.observer) { solverState.observer.disconnect(); solverState.observer = null; }
        });

        document.getElementById('rcst-solver-min').addEventListener('click', () => {
            ui.classList.toggle('minimized');
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

    function renderMenu() {
        if (!solverState.panel) buildUI();
        const content = document.getElementById('rcst-solver-content');
        content.innerHTML = '';
        
        if (solverState.correctAnswers.size === 0) {
            content.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Aguardando interceptação de respostas do servidor...</div>';
            return;
        }

        solverState.correctAnswers.forEach((ans, qId) => {
            const item = document.createElement('div');
            item.className = 'rcst-solver-item' + (ans.marked ? ' marked' : '');
            item.innerHTML = `
                <div class="rcst-solver-q">${ans.questionText}</div>
                <div class="rcst-solver-a">
                    <span class="rcst-solver-badge ${ans.marked ? '' : 'pending'}">${ans.marked ? 'MARCADO' : 'PENDENTE'}</span>
                    ${ans.answerText}
                </div>
            `;
            content.appendChild(item);
        });
    }

    buildUI();
    renderMenu();
})();
