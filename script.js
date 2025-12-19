// --- UTILS ---
const $ = (id) => document.getElementById(id);
const toggleHelp = () => $('help-tooltip').classList.toggle('visible');

const generateId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// EMOJI VIBE CHECK
const EMOJIS = ['👽', '💀', '👻', '🤖', '🤡', '💩', '👺', '👹', '👿', '🤠', '👾', '👀', '🧠', '👁', '👅', '🦴', '🦷', '👄', '💋', '🩸'];
function getVibeCheck(id1, id2) {
    const combined = [id1, id2].sort().join('');
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = ((hash << 5) - hash) + combined.charCodeAt(i);
        hash |= 0;
    }
    const e1 = EMOJIS[Math.abs(hash) % EMOJIS.length];
    const e2 = EMOJIS[Math.abs(hash >> 5) % EMOJIS.length];
    const e3 = EMOJIS[Math.abs(hash >> 10) % EMOJIS.length];
    return `${e1} ${e2} ${e3}`;
}

// --- STATE ---
let peer = null;
let conn = null;
let myId = '';
let role = 'unknown';
const CHUNK_SIZE = 64 * 1024;
const DANGER_ZONE_SIZE = 1 * 1024 * 1024 * 1024;

let receivedFiles = []; // Store blobs: { name, blob, size }

// --- ELEMENTS ---
const els = {
    badge: $('status-badge'),
    link: $('room-link'),
    views: {
        lobby: $('view-lobby'),
        sendReady: $('view-send-ready'),
        sending: $('view-sending'),
        receiving: $('view-receiving'),
        completed: $('view-completed')
    },
    progress: {
        container: $('progress-container'),
        bar: $('progress-bar'),
        text: $('progress-text')
    },
    fileInput: $('file-input'),
    roomInfo: $('room-info'),
    recvFilename: $('receiving-filename'),
    vibeCheck: $('vibe-check-display'),
    fileList: $('file-list')
};

// --- UI HELPERS ---
function showView(name) {
    Object.values(els.views).forEach(el => el.classList.add('hidden'));
    if (els.views[name]) els.views[name].classList.remove('hidden');
}

function setStatus(text) {
    els.badge.innerText = text;
    if (text === 'LOCKED IN' || text === 'CONNECTED') {
        els.badge.classList.add('active');
    } else {
        els.badge.classList.remove('active');
    }
}

function updateProgress(percent) {
    els.progress.container.style.display = 'block';
    els.progress.bar.style.width = `${percent}%`;
    els.progress.text.innerText = `${Math.round(percent)}%`;
}

function resetProgress() {
    els.progress.container.style.display = 'none';
    els.progress.bar.style.width = '0%';
}

function renderFileList() {
    els.fileList.innerHTML = '';
    receivedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <div class="file-info">
                <strong>${file.name}</strong> <br>
                <small>${formatBytes(file.size)}</small>
            </div>
            <div class="file-actions">
                <button onclick="downloadSingle(${index})">⬇</button>
            </div>
        `;
        els.fileList.appendChild(div);
    });
}

function showVibeCheck(emojis) {
    if (!els.vibeCheck) {
        const div = document.createElement('div');
        div.id = 'vibe-check-display';
        div.style.cssText = "margin-top:1rem; font-size:1.5rem; border:3px solid black; padding:0.5rem; background:#fff; transform:rotate(-2deg); box-shadow:4px 4px 0 #000;";
        div.innerHTML = `<span style="font-size:0.8rem; display:block; font-weight:bold; background:black; color:white; padding:0.1rem 0.5rem; margin-bottom:0.2rem;">VIBE CHECK</span>${emojis}`;
        document.querySelectorAll('.drop-zone h2').forEach(h2 => {
            const clone = div.cloneNode(true);
            if (!h2.nextElementSibling || h2.nextElementSibling.id !== 'vibe-check-display') {
                h2.parentNode.insertBefore(clone, h2.nextSibling);
            }
        });
    }
}

// --- APP LOGIC ---

function init() {
    let hash = window.location.hash.replace('#', '');

    if (!hash) {
        // SENDER MODE
        role = 'sender';
        myId = generateId();
        window.location.hash = myId;
        initPeer(myId);
        showView('lobby');
        setStatus("WAITING");
        $('role-indicator').innerText = "YOU: SENDER";
    } else {
        // RECEIVER MODE
        role = 'receiver';
        initPeer(null);
        showView('receiving');
        setStatus("CONNECTING...");
        $('role-indicator').innerText = "YOU: RECEIVER";
    }

    // Display just the ID
    const currentId = window.location.hash.replace('#', '');
    els.link.innerText = currentId;

    els.roomInfo.onclick = () => {
        navigator.clipboard.writeText(window.location.href);
        // Keep the text element, just change content temporarily
        const originalHTML = els.roomInfo.innerHTML;

        // Show copied feedback preserving the layout
        els.roomInfo.innerHTML = `<div style="display:flex; align-items:baseline; gap:12px;">
                <div style="font-size:1.2rem; font-weight:black; color:var(--accent);">LINK COPIED!</div>
                <small style="font-size:0.65rem; font-weight:bold; white-space:nowrap;">READY TO SHARE</small>
        </div>`;

        // Restore original logic
        setTimeout(() => {
            els.roomInfo.innerHTML = originalHTML;
            // Note: els.link reference is pointing to the OLD span. 
            // When we restore innerHTML, that span is re-created.
            // We need to re-acquire the reference or just ensure we don't need it dynamically after this.
            // Since we mainly set it at init, it should be fine.
            // But if we generated a NEW ID (Refresh), we would reload the page anyway.
        }, 2000);
    };
}

function initPeer(id) {
    peer = new Peer(id, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        myId = id;
        if (role === 'receiver') {
            const targetId = window.location.hash.replace('#', '');
            connectToPeer(targetId);
        }
    });

    peer.on('connection', (c) => {
        if (role === 'sender') {
            if (conn && conn.open) {
                c.close();
                return;
            }
            conn = c;
            setupConnection();
            showView('sendReady');
            setStatus("LOCKED IN");
        }
    });

    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'peer-unavailable') {
            alert("Peer not found. Check URL or if Sender is online.");
        } else {
            setStatus("ERROR");
        }
    });
}

function connectToPeer(targetId) {
    conn = peer.connect(targetId, { reliable: true, serialization: 'binary' });
    setupConnection();
}

function setupConnection() {
    conn.on('open', () => {
        const vibes = getVibeCheck(myId, conn.peer);
        if (role === 'receiver') {
            setStatus("CONNECTED");
            els.views.lobby.innerHTML = `<div class='big-icon'>⏳</div><h2>Waiting for files...</h2><p>Sender is choosing files.</p>`;
            showView('lobby');
        }
        showVibeCheck(vibes);
    });

    conn.on('data', (data) => {
        handleData(data);
    });

    conn.on('close', () => {
        setStatus("DISCONNECTED");
        alert("Peer disconnected. Refresh to reset.");
        window.location.reload();
    });
}

// --- FILE TRANSFER LOGIC ---

function setupDragAndDrop() {
    const zone = els.views.sendReady;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('active'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('active');
        if (e.dataTransfer.files.length > 0) prepareFileTransfer(e.dataTransfer.files[0]);
    });
    zone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) prepareFileTransfer(e.target.files[0]);
    });
}

function prepareFileTransfer(file) {
    if (!conn || !conn.open) { alert("Peer not connected!"); return; }
    if (file.size > DANGER_ZONE_SIZE) {
        if (!confirm(`WARNING: File is ${formatBytes(file.size)}. Proceed?`)) return;
    }
    startFileTransfer(file);
}

async function startFileTransfer(file) {
    showView('sending');
    setStatus("SENDING...");
    conn.send({ type: 'meta', name: file.name, size: file.size, mime: file.type });

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let offset = 0;

    function sendNextChunk() {
        if (offset >= file.size) {
            conn.send({ type: 'end' });
            showView('completed'); // Shows list if receiver, back to ready if sender? 
            // Wait, sender should probably go back to 'sendReady' state after a delay or stay in completed?
            // For now, let's just reset sender to sendReady after 1s
            if (role === 'sender') {
                setStatus("DONE");
                setTimeout(() => {
                    showView('sendReady');
                    setStatus("LOCKED IN");
                    resetProgress();
                }, 1000);
            }
            return;
        }
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        reader.onload = (e) => {
            if (!conn || !conn.open) return;
            conn.send({ type: 'chunk', data: e.target.result });
            offset += CHUNK_SIZE;
            const percent = (offset / file.size) * 100;
            updateProgress(Math.min(100, percent));

            if (conn.bufferSize > 10 * 1024 * 1024) {
                setTimeout(sendNextChunk, 100);
            } else {
                setTimeout(sendNextChunk, 0);
            }
        };
        reader.readAsArrayBuffer(slice);
    }
    sendNextChunk();
}

// RECEIVER SIDE
let incomingFile = { meta: null, buffer: [], receivedSize: 0 };

function handleData(data) {
    if (data.type === 'meta') {
        incomingFile.meta = data;
        incomingFile.buffer = [];
        incomingFile.receivedSize = 0;
        showView('receiving');
        els.recvFilename.innerText = `${data.name} (${formatBytes(data.size)})`;
        setStatus("RECEIVING...");
        updateProgress(0);
    } else if (data.type === 'chunk') {
        incomingFile.buffer.push(data.data);
        incomingFile.receivedSize += data.data.byteLength;
        if (incomingFile.meta) updateProgress((incomingFile.receivedSize / incomingFile.meta.size) * 100);
    } else if (data.type === 'end') {
        const blob = new Blob(incomingFile.buffer, { type: incomingFile.meta.mime });
        const fileObj = {
            name: incomingFile.meta.name,
            size: incomingFile.meta.size,
            blob: blob
        };
        receivedFiles.push(fileObj);

        showView('completed');
        setStatus("FILE RECEIVED");
        resetProgress();
        renderFileList();

        incomingFile.buffer = [];
    }
}

function downloadSingle(index) {
    const file = receivedFiles[index];
    if (!file) return;
    triggerDownload(file.blob, file.name);
}

function downloadAll() {
    receivedFiles.forEach(file => {
        triggerDownload(file.blob, file.name);
    });
}

function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setupManualJoin() {
    const btn = $('join-btn');
    const input = $('manual-id-input');

    const join = () => {
        const code = input.value.trim().toUpperCase();
        if (code.length > 0) {
            window.location.hash = code;
            window.location.reload();
        }
    };

    btn.onclick = join;
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') join();
    });
}

// --- BOOTSTRAP ---
setupDragAndDrop();
setupManualJoin();
init();
