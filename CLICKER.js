(function() {
    let clicking = false;
    let clickInterval;
    let lastX = 0, lastY = 0;

    const oldGui = document.getElementById('autoclicker-gui-v2');
    if (oldGui) oldGui.remove();

    const gui = document.createElement('div');
    gui.id = 'autoclicker-gui-v2';
    gui.style = 'position:fixed; top:20px; right:20px; z-index:2147483647; padding:15px; background:#1a1a1a; color:#00ff00; border:2px solid #333; border-radius:10px; font-family:monospace; width:220px; box-shadow:0 10px 30px rgba(0,0,0,0.8); pointer-events:auto;';

    gui.innerHTML = `
        <div style="font-weight:bold; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:10px; text-align:center;">CLICKER by rhyan57</div>
        <div style="font-size:11px; margin-bottom:5px;">VELOCIDADE (ms):</div>
        <input type="number" id="click-ms" value="100" style="width:100%; background:#222; color:#fff; border:1px solid #444; padding:5px; margin-bottom:10px; outline:none;">
        
        <div id="status-display" style="font-size:12px; font-weight:bold; color:#ff4444; margin-bottom:10px; text-align:center;">STATUS: STANDBY</div>
        
        <button id="start-btn" style="width:100%; padding:8px; cursor:pointer; background:#006400; color:white; border:none; border-radius:4px; font-weight:bold; margin-bottom:5px;">START (S)</button>
        <button id="stop-btn" style="width:100%; padding:8px; cursor:pointer; background:#8b0000; color:white; border:none; border-radius:4px; font-weight:bold;">STOP (S)</button>
        <div style="font-size:10px; color:#888; margin-top:10px; line-height:1.2;">* Mantenha o mouse sobre o alvo.<br>* Tecla 'S' liga/desliga.</div>
    `;

    document.body.appendChild(gui);

    const statusTxt = gui.querySelector('#status-display');
    const msInput = gui.querySelector('#click-ms');

    window.addEventListener('mousemove', (e) => {
        lastX = e.clientX;
        lastY = e.clientY;
    });

    function engineClick() {
        gui.style.pointerEvents = 'none'; 
        const target = document.elementFromPoint(lastX, lastY);
        gui.style.pointerEvents = 'auto';

        if (target) {
            const opts = { bubbles: true, cancelable: true, view: window, clientX: lastX, clientY: lastY };
            target.dispatchEvent(new MouseEvent('mousedown', opts));
            target.dispatchEvent(new MouseEvent('mouseup', opts));
            target.dispatchEvent(new MouseEvent('click', opts));
        }
    }

    function toggle() {
        if (!clicking) {
            clicking = true;
            const ms = Math.max(10, parseInt(msInput.value) || 100);
            clickInterval = setInterval(engineClick, ms);
            statusTxt.innerText = "STATUS: ACTIVE";
            statusTxt.style.color = "#00ff00";
        } else {
            clicking = false;
            clearInterval(clickInterval);
            statusTxt.innerText = "STATUS: STANDBY";
            statusTxt.style.color = "#ff4444";
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 's' && document.activeElement !== msInput) {
            toggle();
        }
    });

    gui.querySelector('#start-btn').onclick = toggle;
    gui.querySelector('#stop-btn').onclick = toggle;

})();
