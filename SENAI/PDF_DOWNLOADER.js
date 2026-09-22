(async function() {
    'use strict';
    const L = m => console.log('%c[PDF] ' + m, 'color:#69f0ae;font-weight:bold;font-size:14px');

    const findApp = (w, d) => {
        if (d > 3 || !w) return null;
        try {
            if (w.PDFViewerApplication && w.PDFViewerApplication.pdfDocument) return w;
            for (const f of w.document.querySelectorAll('iframe')) {
                const r = findApp(f.contentWindow, d + 1);
                if (r) return r;
            }
        } catch (e) {}
        return null;
    };
    const win = findApp(window, 0) || window;
    const app = win.PDFViewerApplication;

    let fileUrl = (app && app.url) ? app.url : null;
    if (!fileUrl) {
        for (const r of performance.getEntriesByType('resource'))
            if (/\.drm/i.test(r.name)) { fileUrl = r.name; break; }
    }
    if (!fileUrl) fileUrl = prompt('Cole a URL do .drm (aba Network):');
    if (!fileUrl) return;

    const baseName = decodeURIComponent(fileUrl.split('?')[0].split('/').pop()).replace(/\.drm$/i, '');

    L('Baixando ' + baseName + '...');
    const request = range => {
        const headers = {
            'Accept-Type': 'drm',
            'token': Math.random().toString().replace('.', '')
        };
        if (range) headers['Range'] = range;
        return fetch(fileUrl, { method: 'POST', credentials: 'include', headers });
    };

    const r0 = await request('bytes=0-65535');
    if (!r0.ok) { console.error('HTTP ' + r0.status); return; }

    const cr = r0.headers.get('content-range');
    const total = cr ? parseInt(cr.split('/')[1], 10) : 0;
    const first = new Uint8Array(await r0.arrayBuffer());

    let file;
    if (!total || first.length >= total) {
        file = first;
    } else {
        file = new Uint8Array(total);
        file.set(first, 0);
        const CHUNK = 65536;
        for (let start = first.length; start < total; start += CHUNK * 6) {
            const jobs = [];
            for (let s = start; s < total && s < start + CHUNK * 6; s += CHUNK) {
                const e = Math.min(s + CHUNK, total) - 1;
                jobs.push(request('bytes=' + s + '-' + e).then(async r => {
                    file.set(new Uint8Array(await r.arrayBuffer()), s);
                }));
            }
            await Promise.all(jobs);
            L('Download: ' + Math.min(99, Math.round((start + CHUNK * 6) / total * 100)) + '%');
        }
    }

    L('Arquivo completo: ' + (total / 1048576).toFixed(2) + ' MB');

    const header = String.fromCharCode(...file.subarray(0, 8));
    L('Cabeçalho detectado: "' + header + '"');

    if (header.startsWith('%DRM')) {
        L('Aplicando correção: %DRM → %PDF...');
        file[1] = 0x50; // 'P'
        file[2] = 0x44; // 'D'
        file[3] = 0x46; // 'F'
        L('Cabeçalho corrigido: "' + String.fromCharCode(...file.subarray(0, 8)) + '"');
    } else if (!header.startsWith('%PDF')) {
        console.error('Formato desconhecido: ' + header);
        return;
    }

    const tail = file.subarray(Math.max(0, file.length - 8192));
    const tailStr = String.fromCharCode(...tail);
    const hasEncrypt = tailStr.includes('/Encrypt');
    L(hasEncrypt ? '⚠ PDF possui /Encrypt (pode pedir senha)' : '✓ PDF sem criptografia');

    const url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName.replace(/\.pdf$/i, '') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    L('✅ SALVO: ' + baseName + '.pdf');
    L('Tamanho: ' + (file.length / 1048576).toFixed(2) + ' MB');
    L(hasEncrypt
        ? 'Se pedir senha ao abrir, use a senha do site. Se não souber, me avise.'
        : 'PDF original completo, texto selecionável, abre em qualquer leitor!');
})();
