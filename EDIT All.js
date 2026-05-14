(function() {
    let configKey = localStorage.getItem('ultra-editor-key') || 'E'; 
    let editing = false;
    let hoveredElement = null;
    let isDragging = false;
    let dragTarget = null;
    let offset = { x: 0, y: 0 };

    function iniciarEditor() {
        const oldGui = document.getElementById('dom-editor-gui-v8');
        if (oldGui) oldGui.remove();

        const gui = document.createElement('div');
        gui.id = 'dom-editor-gui-v8';
        gui.style = 'position:fixed; bottom:20px; right:20px; z-index:2147483647; padding:15px; background:#111; color:#00ffcc; border:2px solid #00ffcc; border-radius:10px; font-family:monospace; width:260px; box-shadow:0 10px 30px rgba(0,0,0,0.8); line-height:1.4; pointer-events:auto;';

        gui.innerHTML = `
            <div style="font-weight:bold; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:10px; text-align:center; color:#fff;">EDIT ALL by rhyan57</div>
            
            <div style="font-size:11px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <span>CONFIGURAR TECLA:</span>
                <input type="text" id="shortcut-key" value="${configKey}" style="width:40px; background:#222; color:#fff; border:1px solid #00ffcc; text-align:center; text-transform:uppercase; font-weight:bold;">
            </div>

            <div id="editor-status" style="font-size:12px; font-weight:bold; color:#ff4444; margin-bottom:10px; text-align:center;">MODO: VISUALIZAÇÃO</div>
            
            <div style="font-size:10px; color:#aaa; border-top:1px solid #333; padding-top:8px;">
                <b>Controles de Edição:</b><br>
                • <span style="color:#fff">Clique Duplo</span>: Isola e edita o texto<br>
                • <span style="color:#fff">Clique Fora</span>: Salva e destrava o site<br>
                • <span style="color:#fff">Delete / Backspace</span>: Apaga linha<br>
                • <span style="color:#fff">Ctrl + Clique</span>: Duplica (Clona)<br>
                • <span style="color:#fff">Alt + Arrastar</span>: Move o elemento<br>
                • <span style="color:#fff">Ctrl + Alt + Clique</span>: Texto abaixo
                rhyan57 on discord
            </div>
        `;

        document.body.appendChild(gui);

        const statusTxt = gui.querySelector('#editor-status');
        const keyInput = gui.querySelector('#shortcut-key');

        keyInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            configKey = e.key.toUpperCase();
            keyInput.value = configKey;
            localStorage.setItem('ultra-editor-key', configKey);
        });

        const oldStyle = document.getElementById('dom-editor-styles-v8');
        if (oldStyle) oldStyle.remove();
        
        const style = document.createElement('style');
        style.id = 'dom-editor-styles-v8';
        style.innerHTML = `
            .editor-hover-target-v8 { 
                outline: 2px dashed #00ffcc !important; 
                outline-offset: -2px;
            }
            .editor-dragging-v8 {
                opacity: 0.7 !important;
                outline: 2px solid #ff00ff !important;
                cursor: move !important;
            }
            .editor-focus-v8 {
                outline: 2px solid #ffaa00 !important;
                outline-offset: -2px;
                cursor: text !important;
                user-select: text !important;
                -webkit-user-select: text !important;
            }
        `;
        document.head.appendChild(style);

        function toggleEditor() {
            editing = !editing;
            
            if (editing) {
                statusTxt.innerText = "MODO: EDITOR ATIVO";
                statusTxt.style.color = "#00ff00";
                gui.style.borderColor = "#00ff00";
                initAdvancedListeners();
            } else {
                statusTxt.innerText = "MODO: VISUALIZAÇÃO";
                statusTxt.style.color = "#ff4444";
                gui.style.borderColor = "#00ffcc";
                removeAdvancedListeners();
                limparFocoGlobal();
            }
        }

        function limparFocoGlobal() {
            if(hoveredElement) hoveredElement.classList.remove('editor-hover-target-v8');
            document.querySelectorAll('.editor-focus-v8').forEach(el => {
                el.contentEditable = "false";
                el.classList.remove('editor-focus-v8');
            });
        }

        function getValidTarget(el) {
            if (!el || gui.contains(el) || el === document.body || el === document.documentElement) return null;
            if (el.classList.contains('editor-focus-v8')) return el;

            const validTags = ['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'BUTTON', 'LI', 'TD', 'TH', 'B', 'STRONG', 'I', 'EM'];
            if (validTags.includes(el.tagName)) return el;
            if (el.tagName === 'DIV' && el.children.length <= 1) return el;
            if (el.tagName === 'DIV' && el.innerText.trim() !== "") {
                return el.querySelector('p, span, h1, h2, h3, a, img') || el;
            }
            return el;
        }

        function onMouseMove(e) {
            if (!editing) return;

            if (isDragging && dragTarget) {
                e.preventDefault();
                dragTarget.style.left = (e.clientX - offset.x) + 'px';
                dragTarget.style.top = (e.clientY - offset.y) + 'px';
                return;
            }

            if (gui.contains(e.target)) return;
            const target = getValidTarget(e.target);
            if (!target) return;

            if (document.activeElement && document.activeElement.classList.contains('editor-focus-v8')) return;

            if (hoveredElement !== target) {
                if (hoveredElement) hoveredElement.classList.remove('editor-hover-target-v8');
                hoveredElement = target;
                hoveredElement.classList.add('editor-hover-target-v8');
            }
        }

        function onMouseDown(e) {
            if (!editing || gui.contains(e.target)) return;
            
            if (e.target.classList.contains('editor-focus-v8') || (hoveredElement && hoveredElement.classList.contains('editor-focus-v8'))) {
                e.stopPropagation(); 
                return; 
            }

            if (!e.altKey) return; 
            
            const target = getValidTarget(e.target);
            if (!target) return;

            e.preventDefault();
            isDragging = true;
            dragTarget = target;

            const rect = dragTarget.getBoundingClientRect();
            dragTarget.style.position = 'fixed';
            dragTarget.style.zIndex = '2147483646';
            dragTarget.style.width = rect.width + 'px';
            dragTarget.style.height = rect.height + 'px';
            dragTarget.style.margin = '0';
            
            dragTarget.style.left = rect.left + 'px';
            dragTarget.style.top = rect.top + 'px';

            offset.x = e.clientX - rect.left;
            offset.y = e.clientY - rect.top;

            dragTarget.classList.add('editor-dragging-v8');
        }

        function onMouseUp(e) {
            if (isDragging && dragTarget) {
                isDragging = false;
                dragTarget.classList.remove('editor-dragging-v8');
                dragTarget = null;
            }
            if (e.target.classList.contains('editor-focus-v8')) {
                e.stopPropagation();
            }
        }

        function onKeyDown(e) {
            if (!editing) return;
            
            if (document.activeElement && document.activeElement.classList.contains('editor-focus-v8')) {
                e.stopPropagation(); 
                return; 
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && hoveredElement) {
                const tag = hoveredElement.tagName;
                if (tag === 'BODY' || tag === 'HTML' || hoveredElement.id === 'dom-editor-gui-v8') return;

                e.preventDefault();
                const nextFocus = hoveredElement.nextElementSibling || hoveredElement.parentNode;
                hoveredElement.remove();
                hoveredElement = null;
                
                if (nextFocus) {
                    hoveredElement = getValidTarget(nextFocus);
                    if (hoveredElement) hoveredElement.classList.add('editor-hover-target-v8');
                }
            }
        }

        function onDblClick(e) {
            if (!editing || gui.contains(e.target)) return;
            const target = getValidTarget(e.target);
            if (!target) return;

            e.preventDefault();
            e.stopPropagation(); 
            
            limparFocoGlobal();

            target.classList.remove('editor-hover-target-v8');
            target.classList.add('editor-focus-v8');
            target.contentEditable = "true";
            target.focus();
            
            target.onblur = () => {
                target.contentEditable = "false";
                target.classList.remove('editor-focus-v8');
            };
        }

        function onClick(e) {
            if (!editing || gui.contains(e.target)) return;
            
            if (document.activeElement && !document.activeElement.contains(e.target)) {
                if(document.activeElement.classList.contains('editor-focus-v8')) {
                    document.activeElement.blur();
                }
            }

            const target = getValidTarget(e.target);
            
            if (e.target.classList.contains('editor-focus-v8') || (target && target.classList.contains('editor-focus-v8'))) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (!e.ctrlKey && !e.altKey && target && target.tagName === 'A') {
                e.preventDefault();
            }

            if (e.ctrlKey && !e.altKey && target) {
                e.preventDefault();
                const clone = target.cloneNode(true);
                clone.classList.remove('editor-hover-target-v8', 'editor-focus-v8');
                clone.contentEditable = "false";
                clone.style.position = '';
                clone.style.top = '';
                clone.style.left = '';
                target.parentNode.insertBefore(clone, target.nextSibling);
                return;
            }

            if (e.ctrlKey && e.altKey && target) {
                e.preventDefault();
                const text = prompt("Digite o novo texto que deseja criar embaixo deste item:", "Novo texto editável");
                if (text !== null) {
                    const newSpan = document.createElement('span');
                    newSpan.innerText = text;
                    newSpan.style.display = 'block';
                    newSpan.style.margin = '5px 0';
                    target.parentNode.insertBefore(newSpan, target.nextSibling);
                }
                return;
            }
        }

        function interceptarEventos(e) {
            if (editing && e.target.classList.contains('editor-focus-v8')) {
                e.stopPropagation();
            }
        }

        function initAdvancedListeners() {
            document.addEventListener('mouseover', onMouseMove);
            document.addEventListener('mousedown', onMouseDown, true);
            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mouseup', onMouseUp, true);
            document.addEventListener('keydown', onKeyDown, true); 
            document.addEventListener('click', onClick, true); 
            document.addEventListener('dblclick', onDblClick, true);
            
            document.addEventListener('focus', interceptarEventos, true);
            document.addEventListener('change', interceptarEventos, true);
        }

        function removeAdvancedListeners() {
            document.removeEventListener('mouseover', onMouseMove);
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('dblclick', onDblClick, true);
            document.removeEventListener('focus', interceptarEventos, true);
            document.removeEventListener('change', interceptarEventos, true);
        }

        window.addEventListener('keydown', (e) => {
            if (document.activeElement === keyInput) return;
            if (editing && document.activeElement && document.activeElement.classList.contains('editor-focus-v8')) return;

            if (e.key.toUpperCase() === configKey) {
                e.preventDefault();
                toggleEditor();
            }
        });

        console.log(`%c Editor V8 Carregado! Atalho atual: '${configKey}'`, "color: #00ffcc; font-weight: bold;");
    }

    if (document.body) {
        iniciarEditor();
    } else {
        window.addEventListener('DOMContentLoaded', iniciarEditor);
    }
})();
