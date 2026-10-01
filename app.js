// ========== SUPABASE CONNECTION ==========
const SUPABASE_URL = 'https://gsbuxzftnpkuizaujjiv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnV4emZ0bnBrdWl6YXVqaml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDU0NTIsImV4cCI6MjA5MzA4MTQ1Mn0.djsWFLZJkhEXtEqsq2eu53pxvGF6HaLvPq1uKO2xMnc';

let sb = null; // Supabase client
let APP = { rooms: [], settings: {}, records: [] };

function getConfig() {
    try {
        const stored = JSON.parse(localStorage.getItem('nhatro_config') || 'null');
        if (stored && stored.url && stored.key) return stored;
    } catch (e) {
        console.warn('Lỗi đọc nhatro_config:', e);
    }
    return { url: SUPABASE_URL, key: SUPABASE_KEY };
}
function setConfig(cfg) { localStorage.setItem('nhatro_config', JSON.stringify(cfg)); }

function initClient(url, key) {
    sb = window.supabase.createClient(url, key);
}

// ========== UTILITIES ==========
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.classList.add('hidden'), 300); }, 2200);
}

function showLoading(show) {
    const el = $('#loading-overlay');
    if (el) el.classList.toggle('hidden', !show);
}

function calcRoom(rd, settings, room) {
    const elecUsed = (rd.elecNew || 0) - (rd.elecOld || 0);
    const waterUsed = (rd.waterNew || 0) - (rd.waterOld || 0);
    const elecTotal = elecUsed * settings.elecPrice;
    let waterTotal;
    if (waterUsed <= 10) {
        waterTotal = waterUsed * settings.waterPrice;
    } else {
        waterTotal = 10 * settings.waterPrice + (waterUsed - 10) * settings.waterPriceOver;
    }
    const garbageFee = settings.garbageFee;
    const servicesTotal = elecTotal + waterTotal + garbageFee;
    const roomFee = room ? room.roomFee : 700000;
    const finalTotal = servicesTotal + roomFee;
    return { elecUsed, waterUsed, elecTotal, waterTotal, garbageFee, servicesTotal, roomFee, finalTotal };
}

// ========== DATA LAYER (Supabase) ==========
async function loadAllData() {
    const [roomsRes, settingsRes, recordsRes] = await Promise.all([
        sb.from('rooms').select('*').order('sort_order'),
        sb.from('settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('records').select('*').order('created_at')
    ]);
    if (roomsRes.error) {
        console.error('Lỗi tải rooms:', roomsRes.error);
        throw roomsRes.error;
    }
    APP.rooms = (roomsRes.data || []).map(r => ({ id: r.id, name: r.name, roomFee: r.room_fee, sortOrder: r.sort_order }));
    const s = settingsRes ? settingsRes.data : null;
    APP.settings = s ? { elecPrice: s.elec_price, waterPrice: s.water_price, waterPriceOver: s.water_price_over, garbageFee: s.garbage_fee } : { elecPrice: 3000, waterPrice: 11000, waterPriceOver: 12000, garbageFee: 10000 };
    APP.records = (recordsRes && recordsRes.data) || [];
}

function groupRecords(flat) {
    const groups = {};
    flat.forEach(r => {
        const key = `${r.start_date}||${r.end_date}`;
        if (!groups[key]) groups[key] = { startDate: r.start_date, endDate: r.end_date, data: {}, createdAt: r.created_at };
        groups[key].data[r.room_id] = { recordId: r.id, elecOld: r.elec_old, elecNew: r.elec_new, waterOld: r.water_old, waterNew: r.water_new };
    });
    return Object.values(groups).sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
}

function getPrevReading(roomId) {
    // Find latest record for this room
    for (let i = APP.records.length - 1; i >= 0; i--) {
        if (APP.records[i].room_id === roomId) {
            return { elec: APP.records[i].elec_new || 0, water: APP.records[i].water_new || 0 };
        }
    }
    return { elec: 0, water: 0 };
}

function getLastPeriod() {
    if (APP.records.length === 0) return null;
    const last = APP.records[APP.records.length - 1];
    return { endDate: last.end_date };
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    // Tab navigation
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            $(`#tab-${btn.dataset.tab}`)?.classList.add('active');
            if (btn.dataset.tab === 'history') renderHistory();
            if (btn.dataset.tab === 'settings') renderSettings();
            if (btn.dataset.tab === 'entry') renderEntry();
        });
    });

    // Modal
    $('#close-modal')?.addEventListener('click', () => $('#receipt-modal')?.classList.add('hidden'));
    $('#receipt-modal')?.addEventListener('click', e => { if (e.target === $('#receipt-modal')) $('#receipt-modal')?.classList.add('hidden'); });
    $('#download-btn')?.addEventListener('click', downloadReceipt);
    $('#share-btn')?.addEventListener('click', shareReceipt);

    // Entry
    $('#save-period-btn')?.addEventListener('click', savePeriod);

    // History toolbar
    $('#toggle-comparison-btn')?.addEventListener('click', toggleComparisonView);
    $('#export-history-csv-btn')?.addEventListener('click', exportHistoryCsv);

    // Settings
    $('#save-settings-btn')?.addEventListener('click', saveSettings);
    $('#add-room-btn')?.addEventListener('click', addRoom);
    $('#disconnect-btn')?.addEventListener('click', () => {
        localStorage.removeItem('nhatro_config');
        location.reload();
    });
    $('#backup-download-btn')?.addEventListener('click', exportBackupJson);
    $('#backup-restore-btn')?.addEventListener('click', () => $('#restore-file-input')?.click());
    $('#restore-file-input')?.addEventListener('change', handleRestoreFile);
    $('#save-gemini-key-btn')?.addEventListener('click', saveGeminiKey);

    // OCR Modal
    $('#close-ocr-modal')?.addEventListener('click', closeOcrScanner);
    $('#ocr-modal')?.addEventListener('click', e => { if (e.target === $('#ocr-modal')) closeOcrScanner(); });
    $('#ocr-camera-trigger')?.addEventListener('click', handleCameraTrigger);
    $('#ocr-album-trigger')?.addEventListener('click', () => $('#ocr-file-input')?.click());
    $('#ocr-file-input')?.addEventListener('change', handleFileInputOcr);
    $('#ocr-confirm-btn')?.addEventListener('click', applyOcrResult);
    $('#ocr-dec-btn')?.addEventListener('click', () => {
        const input = $('#ocr-scanned-value');
        if (!input) return;
        const cur = parseInt(input.value, 10);
        if (!isNaN(cur) && cur > 0) {
            input.value = cur - 1;
            updateActiveChip(cur - 1);
        }
    });
    $('#ocr-inc-btn')?.addEventListener('click', () => {
        const input = $('#ocr-scanned-value');
        if (!input) return;
        const cur = parseInt(input.value, 10) || 0;
        input.value = cur + 1;
        updateActiveChip(cur + 1);
    });

    // Setup
    $('#setup-connect-btn')?.addEventListener('click', connectSupabase);

    // Check config
    const cfg = getConfig();
    if (cfg && cfg.url && cfg.key) {
        initClient(cfg.url, cfg.key);
        bootApp();
    } else {
        $('#setup-screen')?.classList.remove('hidden');
    }
});

async function connectSupabase() {
    const url = $('#setup-url')?.value.trim();
    const key = $('#setup-key')?.value.trim();
    const errEl = $('#setup-error');
    if (errEl) errEl.textContent = '';

    if (!url || !key) {
        if (errEl) errEl.textContent = 'Vui lòng nhập đầy đủ URL và Key';
        return;
    }

    const btn = $('#setup-connect-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang kết nối...';
    }

    try {
        initClient(url, key);
        // Test connection
        const { error } = await sb.from('settings').select('id').eq('id', 1).maybeSingle();
        if (error) throw error;

        setConfig({ url, key });
        $('#setup-screen')?.classList.add('hidden');
        await bootApp();
    } catch (e) {
        if (errEl) errEl.textContent = '❌ Không kết nối được. Kiểm tra URL và Key.\n' + (e.message || '');
        sb = null;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 Kết Nối';
        }
    }
}

async function bootApp() {
    showLoading(true);
    try {
        await loadAllData();
        autoFillDates();
        renderEntry();
        const cfg = getConfig();
        if (cfg && $('#connection-info')) $('#connection-info').textContent = '✅ ' + cfg.url;
    } catch (e) {
        console.error('Lỗi bootApp:', e);
        toast('❌ Lỗi tải dữ liệu: ' + (e.message || ''));
    } finally {
        showLoading(false);
    }
}

function autoFillDates() {
    const last = getLastPeriod();
    if (last && last.endDate) {
        $('#startDate').value = last.endDate;
        try {
            const parts = last.endDate.split('/');
            const d = new Date(parts[2], parseInt(parts[1]) - 1, parseInt(parts[0]));
            d.setMonth(d.getMonth() + 1);
            $('#endDate').value = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        } catch (e) { }
    }
}

// ========== ENTRY TAB ==========
function renderEntry() {
    const container = $('#room-cards-container');
    if (!container) return;
    container.innerHTML = '';

    if (!APP.rooms || APP.rooms.length === 0) {
        container.innerHTML = `
            <div class="glass-card" style="text-align:center;padding:24px;color:var(--text2)">
                <p style="font-size:1.05rem;margin-bottom:6px">⚠️ Chưa có dữ liệu phòng</p>
                <p style="font-size:0.82rem">Đang kết nối lại hoặc hãy vào tab <b>⚙️ Cài đặt</b> để kiểm tra.</p>
            </div>`;
        return;
    }

    APP.rooms.forEach(room => {
        const prev = getPrevReading(room.id);
        const card = document.createElement('div');
        card.className = 'room-card';
        card.innerHTML = `
            <div class="room-card-header">
                <h4>${room.name}</h4>
                <span class="room-preview" id="preview-${room.id}"></span>
            </div>
            <div class="meter-row">
                <span class="meter-label">⚡</span>
                <input type="number" class="readonly" id="eOld-${room.id}" value="${prev.elec}" readonly tabindex="-1">
                <span class="arrow">→</span>
                <div class="input-with-cam">
                    <input type="number" id="eNew-${room.id}" placeholder="Số mới" data-room="${room.id}" data-type="entry">
                    <button type="button" class="cam-btn" title="Chụp ảnh công tơ điện" onclick="openOcrScanner('${room.id}', 'elec')">📷</button>
                </div>
            </div>
            <div class="meter-row">
                <span class="meter-label">💧</span>
                <input type="number" class="readonly" id="wOld-${room.id}" value="${prev.water}" readonly tabindex="-1">
                <span class="arrow">→</span>
                <div class="input-with-cam">
                    <input type="number" id="wNew-${room.id}" placeholder="Số mới" data-room="${room.id}" data-type="entry">
                    <button type="button" class="cam-btn" title="Chụp ảnh đồng hồ nước" onclick="openOcrScanner('${room.id}', 'water')">📷</button>
                </div>
            </div>`;
        container.appendChild(card);
    });

    // Live preview
    container.querySelectorAll('input[data-type="entry"]').forEach(inp => {
        inp.addEventListener('input', () => {
            const rid = inp.dataset.room;
            const room = APP.rooms.find(r => r.id === rid);
            const eOld = parseFloat($(`#eOld-${rid}`)?.value) || 0;
            const eNew = parseFloat($(`#eNew-${rid}`)?.value) || 0;
            const wOld = parseFloat($(`#wOld-${rid}`)?.value) || 0;
            const wNew = parseFloat($(`#wNew-${rid}`)?.value) || 0;
            if (eNew > 0 || wNew > 0) {
                const c = calcRoom({ elecOld: eOld, elecNew: eNew, waterOld: wOld, waterNew: wNew }, APP.settings, room);
                const prevEl = $(`#preview-${rid}`);
                if (prevEl) prevEl.textContent = fmt(c.finalTotal) + ' đ';
            } else {
                const prevEl = $(`#preview-${rid}`);
                if (prevEl) prevEl.textContent = '';
            }
        });
    });
}

async function savePeriod() {
    const startDate = $('#startDate').value.trim();
    const endDate = $('#endDate').value.trim();
    if (!startDate || !endDate) { toast('⚠️ Nhập ngày trước!'); return; }

    const rows = [];
    APP.rooms.forEach(room => {
        const eOld = parseFloat($(`#eOld-${room.id}`).value) || 0;
        const eNew = parseFloat($(`#eNew-${room.id}`).value) || 0;
        const wOld = parseFloat($(`#wOld-${room.id}`).value) || 0;
        const wNew = parseFloat($(`#wNew-${room.id}`).value) || 0;
        if (eNew > 0 || wNew > 0) {
            rows.push({ start_date: startDate, end_date: endDate, room_id: room.id, elec_old: eOld, elec_new: eNew, water_old: wOld, water_new: wNew });
        }
    });

    if (rows.length === 0) { toast('⚠️ Nhập số mới ít nhất 1 phòng!'); return; }

    const btn = $('#save-period-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Đang lưu...';

    try {
        const { error } = await sb.from('records').insert(rows);
        if (error) throw error;
        saveLocalMonthlySnapshot(startDate, endDate, rows);
        await loadAllData();
        toast('✅ Đã lưu kỳ ' + startDate + ' → ' + endDate);
        autoFillDates();
        renderEntry();
    } catch (e) {
        console.error(e);
        toast('❌ Lỗi lưu: ' + (e.message || ''));
    }
    btn.disabled = false;
    btn.textContent = '💾 Lưu Kỳ Này';
}

// ========== HISTORY TAB ==========
function renderHistory() {
    const container = $('#history-container');
    const periods = groupRecords(APP.records);
    if (periods.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📭</div><p>Chưa có dữ liệu.<br>Hãy nhập liệu kỳ đầu tiên!</p></div>';
        return;
    }

    let html = '';
    [...periods].reverse().forEach(rec => {
        const rooms = APP.rooms;
        html += `<div class="history-period">`;
        html += `<div class="history-period-header" onclick="togglePeriod(this)">
            <h4>📅 ${rec.startDate} → ${rec.endDate}</h4>
            <span class="period-toggle">▼</span>
        </div>`;
        html += `<div class="history-table-wrap"><table class="history-table">`;

        html += `<tr><th class="label-col">${rec.startDate}</th>`;
        rooms.forEach(r => html += `<th colspan="2" class="room-header">${r.name}</th>`);
        html += `</tr><tr><th class="label-col">${rec.endDate}</th>`;
        rooms.forEach(() => html += `<th class="sub-header">Điện</th><th class="sub-header">Nước</th>`);
        html += `</tr>`;

        const rowDefs = [
            { label: 'Số mới', get: (d) => [fmt(d.elecNew), fmt(d.waterNew)] },
            { label: 'Số cũ', get: (d) => [fmt(d.elecOld), fmt(d.waterOld)] },
            { label: 'Sử dụng', get: (d, c) => [fmt(c.elecUsed), fmt(c.waterUsed)] },
            { label: 'Đơn giá', get: (d, c) => [fmt(APP.settings.elecPrice), c.waterUsed > 10 ? fmt(APP.settings.waterPriceOver) : fmt(APP.settings.waterPrice)] },
            { label: 'Thành tiền', get: (d, c) => [fmt(c.elecTotal), fmt(c.waterTotal)] },
        ];

        rowDefs.forEach(def => {
            html += `<tr><td class="label-col">${def.label}</td>`;
            rooms.forEach(r => {
                const d = rec.data[r.id];
                if (d) {
                    const c = calcRoom(d, APP.settings, r);
                    const v = def.get(d, c);
                    html += `<td>${v[0]}</td><td>${v[1]}</td>`;
                } else html += `<td>-</td><td>-</td>`;
            });
            html += `</tr>`;
        });

        // Tổng
        html += `<tr class="total-row"><td class="label-col total-label"><b>Tổng (Đ+N+R)</b></td>`;
        rooms.forEach(r => {
            const d = rec.data[r.id];
            if (d) { const c = calcRoom(d, APP.settings, r); html += `<td colspan="2"><b>${fmt(c.servicesTotal)}</b></td>`; }
            else html += `<td colspan="2">-</td>`;
        });
        html += `</tr>`;

        // Giá cuối
        html += `<tr class="final-row"><td class="label-col final-label"><b>Giá cuối</b></td>`;
        rooms.forEach(r => {
            const d = rec.data[r.id];
            if (d) { const c = calcRoom(d, APP.settings, r); html += `<td colspan="2"><b>${fmt(c.finalTotal)}</b></td>`; }
            else html += `<td colspan="2">-</td>`;
        });
        html += `</tr></table></div>`;

        // Actions
        html += `<div class="history-actions">`;
        rooms.forEach(r => {
            if (rec.data[r.id]) html += `<button class="btn-receipt" onclick="showReceipt('${rec.startDate}','${rec.endDate}','${r.id}')">📋 ${r.name}</button>`;
        });
        html += `<button class="btn-delete" onclick="deletePeriod('${rec.startDate}','${rec.endDate}')">🗑️ Xoá</button>`;
        html += `</div></div>`;
    });

    container.innerHTML = html;
}

function togglePeriod(el) {
    const wrap = el.nextElementSibling;
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
}

async function deletePeriod(startDate, endDate) {
    if (!confirm('Xoá kỳ thu tiền này?')) return;
    showLoading(true);
    try {
        const { error } = await sb.from('records').delete().eq('start_date', startDate).eq('end_date', endDate);
        if (error) throw error;
        await loadAllData();
        renderHistory();
        autoFillDates();
        toast('🗑️ Đã xoá');
    } catch (e) { toast('❌ Lỗi xoá'); console.error(e); }
    showLoading(false);
}

// ========== RECEIPT ==========
function showReceipt(startDate, endDate, roomId) {
    const room = APP.rooms.find(r => r.id === roomId);
    if (!room) return;

    const periods = groupRecords(APP.records);
    const period = periods.find(p => p.startDate === startDate && p.endDate === endDate);
    if (!period || !period.data[roomId]) return;

    const d = period.data[roomId];
    const c = calcRoom(d, APP.settings, room);

    const area = $('#receipt-capture-area');
    area.innerHTML = `
        <table class="receipt-table">
            <tr><td class="r-date">${startDate}</td><th colspan="2" class="r-room">${room.name}</th></tr>
            <tr><td class="r-date r-border-heavy">${endDate}</td><th class="r-service">Điện</th><th class="r-service">Nước</th></tr>
            <tr><td>Số mới</td><td>${fmt(d.elecNew)}</td><td>${fmt(d.waterNew)}</td></tr>
            <tr><td>Số cũ</td><td>${fmt(d.elecOld)}</td><td>${fmt(d.waterOld)}</td></tr>
            <tr><td>Sử dụng</td><td>${fmt(c.elecUsed)}</td><td>${fmt(c.waterUsed)}</td></tr>
            <tr><td>Giá</td><td>${fmt(APP.settings.elecPrice)}</td><td>${c.waterUsed > 10 ? fmt(APP.settings.waterPriceOver) : fmt(APP.settings.waterPrice)}</td></tr>
            <tr><td class="r-border-heavy">Thành tiền</td><td class="r-border-heavy">${fmt(c.elecTotal)}</td><td class="r-border-heavy">${fmt(c.waterTotal)}</td></tr>
            <tr><th>Tổng (Đ+N+R)</th><th colspan="2" class="r-total">${fmt(c.servicesTotal)}</th></tr>
            <tr><th>Giá cuối</th><th colspan="2" class="r-final">${fmt(c.finalTotal)}</th></tr>
        </table>
        <div class="receipt-notes">
            <p><u>Chú ý :</u></p>
            <p>+ Tiền rác : ${fmt(APP.settings.garbageFee)} vnđ/tháng</p>
            <p>+ Điện : ${fmt(APP.settings.elecPrice)} vnđ/Kw</p>
            <p class="indent">Nước trên 10m³ : ${fmt(APP.settings.waterPriceOver)} vnđ/m³</p>
            <p>+ Tiền phòng : ${fmt(room.roomFee)} vnđ/tháng</p>
        </div>`;
    area.dataset.roomName = room.name;
    area.dataset.endDate = endDate;
    $('#receipt-modal').classList.remove('hidden');
}

function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

async function downloadReceipt() {
    const area = $('#receipt-capture-area');
    const btn = $('#download-btn');
    try {
        btn.textContent = '⏳ Đang tạo...';
        btn.disabled = true;
        const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const rawName = (area.dataset.roomName || 'Phong').replace(/\s+/g, '_');
        const date = (area.dataset.endDate || '').replace(/\//g, '-');
        const fileName = removeDiacritics(`PhieuThu_${rawName}_${date}.png`);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

        // === STRATEGY 1: CAPACITOR (Android APK) - Lưu thẳng, không hiện dialog ===
        if (window.Capacitor && Capacitor.isNativePlatform()) {
            try {
                const Filesystem = Capacitor.Plugins.Filesystem;

                if (Filesystem) {
                    // Xin quyền ghi file
                    try {
                        await Filesystem.requestPermissions();
                    } catch (e) { /* ignore if already granted */ }

                    const base64Data = canvas.toDataURL('image/png').split(',')[1];

                    // Lưu thẳng vào thư mục bên ngoài (không cần dialog)
                    const result = await Filesystem.writeFile({
                        path: 'PhieuThu/' + fileName,
                        data: base64Data,
                        directory: 'EXTERNAL',
                        recursive: true
                    });

                    toast('✅ Đã lưu: ' + fileName);
                    btn.textContent = '✅ Đã lưu!';
                    setTimeout(() => { btn.textContent = '📸 Tải Ảnh'; btn.disabled = false; }, 2000);
                    return;
                }
            } catch (err) {
                console.error('Capacitor save error:', err);
                // Fall through to web strategies
            }
        }

        // === STRATEGY 2: Web Share API (mobile browsers) ===
        if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: 'image/png' })] })) {
            try {
                const file = new File([blob], fileName, { type: 'image/png' });
                await navigator.share({
                    title: 'Phiếu Thu Tiền Trọ',
                    files: [file]
                });
                btn.textContent = '✅ Đã chia sẻ!';
                setTimeout(() => { btn.textContent = '📸 Tải Ảnh'; btn.disabled = false; }, 2000);
                return;
            } catch (err) {
                if (err.name === 'AbortError') {
                    btn.textContent = '📸 Tải Ảnh';
                    btn.disabled = false;
                    return;
                }
                console.error('Web Share error:', err);
            }
        }

        // === STRATEGY 3: Save As dialog (desktop Chrome/Edge) ===
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                btn.textContent = '✅ Đã lưu!';
                setTimeout(() => { btn.textContent = '📸 Tải Ảnh'; btn.disabled = false; }, 2000);
                return;
            } catch (err) {
                if (err.name === 'AbortError') {
                    btn.textContent = '📸 Tải Ảnh';
                    btn.disabled = false;
                    return;
                }
            }
        }

        // === STRATEGY 4: FALLBACK - blob URL download ===
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.download = fileName;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 3000);

        btn.textContent = '✅ Đã tải!';
        setTimeout(() => { btn.textContent = '📸 Tải Ảnh'; btn.disabled = false; }, 2000);
    } catch (e) {
        console.error(e);
        toast('❌ Lỗi tải ảnh');
        btn.textContent = '📸 Lưu Ảnh';
        btn.disabled = false;
    }
}

async function shareReceipt() {
    const area = $('#receipt-capture-area');
    const btn = $('#share-btn');
    try {
        btn.textContent = '⏳ Đang tạo...';
        btn.disabled = true;
        const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const rawName = (area.dataset.roomName || 'Phong').replace(/\s+/g, '_');
        const date = (area.dataset.endDate || '').replace(/\//g, '-');
        const fileName = removeDiacritics(`PhieuThu_${rawName}_${date}.png`);

        // === CAPACITOR (Android APK) ===
        if (window.Capacitor && Capacitor.isNativePlatform()) {
            try {
                const Filesystem = Capacitor.Plugins.Filesystem;
                const Share = Capacitor.Plugins.Share;

                if (Filesystem && Share) {
                    try { await Filesystem.requestPermissions(); } catch (e) { }

                    const base64Data = canvas.toDataURL('image/png').split(',')[1];

                    // Lưu vào cache trước
                    const result = await Filesystem.writeFile({
                        path: fileName,
                        data: base64Data,
                        directory: 'CACHE',
                        recursive: true
                    });

                    // Mở menu chia sẻ → chọn Zalo → chọn người → gửi
                    await Share.share({
                        title: fileName,
                        text: 'Phiếu Thu Tiền Trọ - ' + (area.dataset.roomName || ''),
                        url: result.uri,
                        dialogTitle: 'Gửi phiếu thu qua...'
                    });

                    btn.textContent = '✅ Đã gửi!';
                    setTimeout(() => { btn.textContent = '📤 Gửi Zalo'; btn.disabled = false; }, 2000);
                    return;
                }
            } catch (err) {
                if (err.message && err.message.includes('cancel')) {
                    btn.textContent = '📤 Gửi Zalo';
                    btn.disabled = false;
                    return;
                }
                console.error('Capacitor share error:', err);
            }
        }

        // === Web Share API (fallback) ===
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: 'image/png' })] })) {
            try {
                const file = new File([blob], fileName, { type: 'image/png' });
                await navigator.share({
                    title: 'Phiếu Thu Tiền Trọ',
                    text: area.dataset.roomName || '',
                    files: [file]
                });
                btn.textContent = '✅ Đã gửi!';
                setTimeout(() => { btn.textContent = '📤 Gửi Zalo'; btn.disabled = false; }, 2000);
                return;
            } catch (err) {
                if (err.name === 'AbortError') {
                    btn.textContent = '📤 Gửi Zalo';
                    btn.disabled = false;
                    return;
                }
            }
        }

        toast('⚠️ Thiết bị không hỗ trợ chia sẻ');
        btn.textContent = '📤 Gửi Zalo';
        btn.disabled = false;
    } catch (e) {
        console.error(e);
        toast('❌ Lỗi gửi ảnh');
        btn.textContent = '📤 Gửi Zalo';
        btn.disabled = false;
    }
}

// ========== SETTINGS TAB ==========
function renderSettings() {
    const list = $('#room-list');
    list.innerHTML = '';
    APP.rooms.forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <span class="room-name">${r.name}</span>
            <span class="room-fee">${fmt(r.roomFee)} đ</span>
            <button class="delete-room" onclick="removeRoom('${r.id}')" title="Xoá phòng">×</button>`;
        list.appendChild(div);
    });
    $('#set-elecPrice').value = APP.settings.elecPrice;
    $('#set-waterPrice').value = APP.settings.waterPrice;
    $('#set-waterPriceOver').value = APP.settings.waterPriceOver;
    $('#set-garbageFee').value = APP.settings.garbageFee;

    const geminiKey = localStorage.getItem('nhatro_gemini_key') || '';
    if ($('#set-gemini-key')) $('#set-gemini-key').value = geminiKey;

    const snapshots = JSON.parse(localStorage.getItem('nhatro_monthly_snapshots') || '[]');
    const lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    const tagEl = $('#backup-status-tag');
    if (tagEl) {
        if (lastSnap) {
            tagEl.innerHTML = `<span>🕒 Snapshot tự động: <b>${lastSnap.startDate} → ${lastSnap.endDate}</b> (${snapshots.length} kỳ lưu trữ)</span>`;
        } else {
            tagEl.innerHTML = `<span>🕒 Chưa có bản snapshot nào. Sẽ tự động lưu sau mỗi lần bạn bấm "Lưu Kỳ Này".</span>`;
        }
    }
}

async function addRoom() {
    const nameInput = $('#new-room-name');
    const feeInput = $('#new-room-fee');
    const name = nameInput.value.trim();
    const fee = parseFloat(feeInput.value) || 700000;
    if (!name) { toast('⚠️ Nhập tên phòng!'); return; }

    const maxOrder = APP.rooms.reduce((m, r) => Math.max(m, r.sortOrder || 0), 0);
    try {
        const { error } = await sb.from('rooms').insert({ name, room_fee: fee, sort_order: maxOrder + 1 });
        if (error) throw error;
        await loadAllData();
        nameInput.value = '';
        feeInput.value = '';
        renderSettings();
        toast('✅ Đã thêm ' + name);
    } catch (e) { toast('❌ Lỗi thêm phòng'); console.error(e); }
}

async function removeRoom(id) {
    const room = APP.rooms.find(r => r.id === id);
    if (!room) return;
    const confirmMsg = `⚠️ CẢNH BÁO NGUY HIỂM:\nXoá "${room.name}" sẽ xoá vĩnh viễn phòng này và toàn bộ lịch sử số điện nước liên quan!\n\nBạn có chắc chắn muốn xoá không?`;
    if (!confirm(confirmMsg)) return;
    try {
        const { error } = await sb.from('rooms').delete().eq('id', id);
        if (error) throw error;
        await loadAllData();
        renderSettings();
        renderEntry();
        toast('🗑️ Đã xoá ' + room.name);
    } catch (e) { toast('❌ Lỗi xoá phòng'); console.error(e); }
}

async function saveSettings() {
    const data = {
        elec_price: parseFloat($('#set-elecPrice').value) || 3000,
        water_price: parseFloat($('#set-waterPrice').value) || 11000,
        water_price_over: parseFloat($('#set-waterPriceOver').value) || 12000,
        garbage_fee: parseFloat($('#set-garbageFee').value) || 10000,
    };
    try {
        const { error } = await sb.from('settings').update(data).eq('id', 1);
        if (error) throw error;
        APP.settings = { elecPrice: data.elec_price, waterPrice: data.water_price, waterPriceOver: data.water_price_over, garbageFee: data.garbage_fee };
        toast('✅ Đã lưu cài đặt');
    } catch (e) { toast('❌ Lỗi lưu cài đặt'); console.error(e); }
}

// ========== SAO LƯU & ĐỐI CHIẾU DỮ LIỆU HÀNG THÁNG ==========

function saveGeminiKey() {
    const key = $('#set-gemini-key').value.trim();
    localStorage.setItem('nhatro_gemini_key', key);
    toast(key ? '✅ Đã lưu Gemini API Key!' : 'ℹ️ Đã xóa Gemini Key (chuyển về Tesseract)');
}

function saveLocalMonthlySnapshot(startDate, endDate, rows) {
    try {
        const snapshots = JSON.parse(localStorage.getItem('nhatro_monthly_snapshots') || '[]');
        const snapshot = {
            id: 'snap_' + Date.now(),
            savedAt: new Date().toISOString(),
            startDate,
            endDate,
            rows,
            settings: { ...APP.settings },
            rooms: APP.rooms.map(r => ({ id: r.id, name: r.name, roomFee: r.roomFee }))
        };
        // Lọc bỏ kỳ trùng lặp nếu có
        const filtered = snapshots.filter(s => !(s.startDate === startDate && s.endDate === endDate));
        filtered.push(snapshot);
        // Lưu tối đa 48 tháng
        if (filtered.length > 48) filtered.shift();
        localStorage.setItem('nhatro_monthly_snapshots', JSON.stringify(filtered));
        console.log('✅ Đã lưu bản snapshot cục bộ cho kỳ:', startDate, '→', endDate);
    } catch (e) {
        console.warn('Lỗi lưu snapshot cục bộ:', e);
    }
}

function exportBackupJson() {
    const data = {
        appName: 'QuanLyNhaTro',
        version: '1.2',
        exportDate: new Date().toISOString(),
        supabaseUrl: (getConfig() || {}).url || '',
        rooms: APP.rooms,
        settings: APP.settings,
        records: APP.records,
        localSnapshots: JSON.parse(localStorage.getItem('nhatro_monthly_snapshots') || '[]')
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `NhaTro_Backup_${dateStr}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✅ Đã tải file sao lưu về máy!');
}

async function handleRestoreFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.rooms || !data.records) {
            toast('❌ File sao lưu không hợp lệ!');
            return;
        }

        const confirmMsg = `Bạn có chắc muốn khôi phục dữ liệu từ file này?\n- Số phòng: ${data.rooms.length}\n- Số bản ghi: ${data.records.length}\nNgày tạo: ${data.exportDate || 'Không rõ'}`;
        if (!confirm(confirmMsg)) return;

        showLoading(true);
        $('#loading-text').textContent = 'Đang khôi phục dữ liệu vào Database...';

        // 1. Phục hồi Settings
        if (data.settings) {
            await sb.from('settings').upsert({
                id: 1,
                elec_price: data.settings.elecPrice || data.settings.elec_price || 3000,
                water_price: data.settings.waterPrice || data.settings.water_price || 11000,
                water_price_over: data.settings.waterPriceOver || data.settings.water_price_over || 12000,
                garbage_fee: data.settings.garbageFee || data.settings.garbage_fee || 10000
            });
        }

        // 2. Phục hồi Rooms
        if (data.rooms && data.rooms.length > 0) {
            const roomRows = data.rooms.map((r, idx) => ({
                id: r.id,
                name: r.name,
                room_fee: r.roomFee || r.room_fee || 700000,
                sort_order: r.sortOrder || r.sort_order || idx + 1
            }));
            await sb.from('rooms').upsert(roomRows);
        }

        // 3. Phục hồi Records
        if (data.records && data.records.length > 0) {
            const recordRows = data.records.map(r => ({
                id: r.id,
                start_date: r.start_date || r.startDate,
                end_date: r.end_date || r.endDate,
                room_id: r.room_id || r.roomId,
                elec_old: r.elec_old !== undefined ? r.elec_old : r.elecOld,
                elec_new: r.elec_new !== undefined ? r.elec_new : r.elecNew,
                water_old: r.water_old !== undefined ? r.water_old : r.waterOld,
                water_new: r.water_new !== undefined ? r.water_new : r.waterNew,
                created_at: r.created_at || r.createdAt || new Date().toISOString()
            }));
            await sb.from('records').upsert(recordRows);
        }

        // 4. Lưu lại snapshots cục bộ nếu có
        if (data.localSnapshots) {
            localStorage.setItem('nhatro_monthly_snapshots', JSON.stringify(data.localSnapshots));
        }

        await loadAllData();
        renderEntry();
        renderHistory();
        renderSettings();
        toast('🎉 Khôi phục dữ liệu thành công!');
    } catch (err) {
        console.error(err);
        toast('❌ Lỗi khi đọc file phục hồi: ' + err.message);
    } finally {
        showLoading(false);
        $('#loading-text').textContent = 'Đang tải dữ liệu...';
        e.target.value = '';
    }
}

function exportHistoryCsv() {
    const periods = groupRecords(APP.records);
    if (periods.length === 0) {
        toast('⚠️ Chưa có dữ liệu lịch sử để xuất!');
        return;
    }

    let csvContent = '\uFEFF'; // BOM UTF-8 để mở tiếng Việt không bị lỗi font trên Excel
    csvContent += 'Từ ngày,Đến ngày,Tên phòng,Điện cũ,Điện mới,Điện tiêu thụ (kWh),Tiền điện (đ),Nước cũ,Nước mới,Nước tiêu thụ (m³),Tiền nước (đ),Tiền rác (đ),Tiền phòng (đ),Tổng cộng (đ)\n';

    periods.forEach(p => {
        APP.rooms.forEach(r => {
            const d = p.data[r.id];
            if (d) {
                const c = calcRoom(d, APP.settings, r);
                csvContent += `"${p.startDate}","${p.endDate}","${r.name}",${d.elecOld},${d.elecNew},${c.elecUsed},${c.elecTotal},${d.waterOld},${d.waterNew},${c.waterUsed},${c.waterTotal},${c.garbageFee},${c.roomFee},${c.finalTotal}\n`;
            }
        });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `DoiChieu_DienNuoc_${dateStr}.csv`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✅ Đã xuất bảng đối chiếu Excel (CSV)!');
}

function toggleComparisonView() {
    const compBox = $('#comparison-container');
    const btn = $('#toggle-comparison-btn');
    if (!compBox.classList.contains('hidden')) {
        compBox.classList.add('hidden');
        btn.classList.remove('active');
        return;
    }

    const periods = groupRecords(APP.records);
    if (periods.length < 2) {
        toast('⚠️ Cần ít nhất 2 kỳ thu tiền để so sánh đối chiếu!');
        return;
    }

    const curr = periods[periods.length - 1];
    const prev = periods[periods.length - 2];

    let html = `
        <h3>📈 Đối Chiếu Tiêu Thụ (${curr.startDate} → ${curr.endDate} so với kỳ trước)</h3>
        <p style="font-size:0.75rem;color:var(--text2);margin-bottom:8px">Cảnh báo màu đỏ nổi bật nếu chỉ số tiêu thụ tăng đột biến trên 50% so với kỳ trước.</p>
        <div style="overflow-x:auto">
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Phòng</th>
                    <th>Điện (kWh)</th>
                    <th>Biến động Điện</th>
                    <th>Nước (m³)</th>
                    <th>Biến động Nước</th>
                </tr>
            </thead>
            <tbody>`;

    APP.rooms.forEach(r => {
        const dCurr = curr.data[r.id];
        const dPrev = prev.data[r.id];

        if (dCurr && dPrev) {
            const cCurr = calcRoom(dCurr, APP.settings, r);
            const cPrev = calcRoom(dPrev, APP.settings, r);

            const eDiff = cCurr.elecUsed - cPrev.elecUsed;
            const ePct = cPrev.elecUsed > 0 ? ((eDiff / cPrev.elecUsed) * 100).toFixed(0) : 0;
            const wDiff = cCurr.waterUsed - cPrev.waterUsed;
            const wPct = cPrev.waterUsed > 0 ? ((wDiff / cPrev.waterUsed) * 100).toFixed(0) : 0;

            const isElecSurge = eDiff > 0 && ePct >= 50;
            const isWaterSurge = wDiff > 0 && wPct >= 50;

            const eClass = eDiff > 0 ? 'diff-up' : (eDiff < 0 ? 'diff-down' : 'diff-same');
            const wClass = wDiff > 0 ? 'diff-up' : (wDiff < 0 ? 'diff-down' : 'diff-same');

            html += `
                <tr>
                    <td><b>${r.name}</b></td>
                    <td>${cCurr.elecUsed}</td>
                    <td class="${eClass}">${isElecSurge ? '⚠️ ' : ''}${eDiff > 0 ? '+' : ''}${eDiff} (${eDiff > 0 ? '+' : ''}${ePct}%)</td>
                    <td>${cCurr.waterUsed}</td>
                    <td class="${wClass}">${isWaterSurge ? '⚠️ ' : ''}${wDiff > 0 ? '+' : ''}${wDiff} (${wDiff > 0 ? '+' : ''}${wPct}%)</td>
                </tr>`;
        }
    });

    html += `</tbody></table></div>`;
    compBox.innerHTML = html;
    compBox.classList.remove('hidden');
    btn.classList.add('active');
}

// ========== CAMERA OCR SCANNER ==========
let CURRENT_OCR = {
    roomId: null,
    meterType: null, // 'elec' | 'water'
    stream: null
};

function openOcrScanner(roomId, meterType) {
    CURRENT_OCR.roomId = roomId;
    CURRENT_OCR.meterType = meterType;

    const room = APP.rooms.find(r => r.id === roomId);
    const isWater = meterType === 'water';
    const label = isWater ? 'Đồng Hồ Nước (m³)' : 'Công Tơ Điện (kWh)';
    $('#ocr-modal-title').textContent = `📸 Quét ${label} - ${room ? room.name : ''}`;

    // Cập nhật hướng dẫn ngắm số
    const guideHint = document.querySelector('.ocr-guide-hint');
    if (guideHint) {
        guideHint.textContent = isWater
            ? 'Căn hàng con lăn vào khung (Chỉ lấy số đen m³)'
            : 'Căn hàng số công tơ vào khung (Chỉ lấy số đen kWh)';
    }

    // Cập nhật thẻ Engine
    const geminiKey = localStorage.getItem('nhatro_gemini_key') || '';
    const badge = $('#ocr-engine-tag');
    if (geminiKey) {
        badge.className = 'ocr-tag ai';
        badge.textContent = '🤖 Google Gemini AI (Chính xác cao)';
    } else {
        badge.className = 'ocr-tag offline';
        badge.textContent = '⚙️ Tesseract OCR (Offline)';
    }

    // Reset trạng thái
    $('#ocr-msg').textContent = '';
    $('#ocr-placeholder').classList.remove('hidden');
    $('#ocr-video').classList.add('hidden');
    $('#ocr-preview').classList.add('hidden');
    $('#ocr-guide').classList.add('hidden');
    $('#ocr-result-area').classList.add('hidden');
    const noteEl = $('#ocr-result-note');
    if (noteEl) {
        noteEl.classList.add('hidden');
        noteEl.textContent = '';
    }
    const suggEl = $('#ocr-suggestions');
    if (suggEl) suggEl.innerHTML = '';
    $('#ocr-scanned-value').value = '';

    // Mở modal
    $('#ocr-modal').classList.remove('hidden');

    // Thử mở camera trực tiếp
    startCameraStream();
}

function startCameraStream() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        }).then(stream => {
            CURRENT_OCR.stream = stream;
            const video = $('#ocr-video');
            video.srcObject = stream;
            video.classList.remove('hidden');
            $('#ocr-placeholder').classList.add('hidden');
            $('#ocr-guide').classList.remove('hidden');
            $('#ocr-camera-trigger').textContent = '📸 Bấm Chụp Ngay';
        }).catch(err => {
            console.log('Không thể mở video stream trực tiếp:', err);
            $('#ocr-camera-trigger').textContent = '📷 Mở Máy Ảnh';
        });
    } else {
        $('#ocr-camera-trigger').textContent = '📷 Mở Máy Ảnh';
    }
}

function closeOcrScanner() {
    if (CURRENT_OCR.stream) {
        CURRENT_OCR.stream.getTracks().forEach(track => track.stop());
        CURRENT_OCR.stream = null;
    }
    $('#ocr-modal').classList.add('hidden');
}

function handleCameraTrigger() {
    const video = $('#ocr-video');
    // Nếu đang có camera stream phát trực tiếp
    if (CURRENT_OCR.stream && !video.classList.contains('hidden') && video.videoWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Tắt stream
        CURRENT_OCR.stream.getTracks().forEach(track => track.stop());
        CURRENT_OCR.stream = null;

        // Hiển thị ảnh vừa chụp
        const imgUrl = canvas.toDataURL('image/jpeg', 0.9);
        $('#ocr-preview').src = imgUrl;
        $('#ocr-preview').classList.remove('hidden');
        video.classList.add('hidden');
        $('#ocr-guide').classList.add('hidden');
        $('#ocr-camera-trigger').textContent = '🔄 Chụp Lại';

        // Tiến hành nhận diện
        processOcrRecognition(canvas);
    } else {
        // Mở file input máy ảnh của điện thoại
        $('#ocr-file-input').click();
    }
}

function handleFileInputOcr(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (CURRENT_OCR.stream) {
        CURRENT_OCR.stream.getTracks().forEach(track => track.stop());
        CURRENT_OCR.stream = null;
    }

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        $('#ocr-preview').src = canvas.toDataURL('image/jpeg', 0.9);
        $('#ocr-preview').classList.remove('hidden');
        $('#ocr-video').classList.add('hidden');
        $('#ocr-placeholder').classList.add('hidden');
        $('#ocr-guide').classList.add('hidden');
        $('#ocr-camera-trigger').textContent = '🔄 Chụp Lại';

        processOcrRecognition(canvas);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
}

async function processOcrRecognition(canvas) {
    const msgEl = $('#ocr-msg');
    const resultArea = $('#ocr-result-area');
    const inputVal = $('#ocr-scanned-value');
    const noteEl = $('#ocr-result-note');
    const suggEl = $('#ocr-suggestions');

    msgEl.textContent = '⏳ Đang quét và phân tích chỉ số...';
    resultArea.classList.add('hidden');
    if (noteEl) {
        noteEl.classList.add('hidden');
        noteEl.textContent = '';
    }
    if (suggEl) suggEl.innerHTML = '';

    const isWater = CURRENT_OCR.meterType === 'water';
    const geminiKey = localStorage.getItem('nhatro_gemini_key') || '';

    // === OPTION 1: GOOGLE GEMINI VISION AI (Siêu chuẩn xác & phân biệt số đỏ) ===
    if (geminiKey) {
        try {
            msgEl.textContent = '🤖 Đang phân tích bằng Gemini AI...';
            const base64Data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
            const promptText = isWater
                ? `Bạn là chuyên gia thị giác máy tính đọc chỉ số ĐỒNG HỒ NƯỚC sinh hoạt tại Việt Nam (như các hiệu LXS-15E, Zenner, Kent, Asahi...).
Nhiệm vụ: Đọc chỉ số tiêu thụ nước (số khối m³) trên mặt đồng hồ trong ảnh để tính tiền phòng trọ.

QUY TẮC BẮT BUỘC:
1. DÃY HỘP SỐ CON LĂN: Nhìn vào dãy con lăn số nằm ngang ở giữa mặt đồng hồ (thường gồm 5 chữ số: 4 số đầu màu ĐEN và 1 số cuối cùng bên phải màu ĐỎ hoặc viền đỏ).
2. QUY TẮC BỎ SỐ ĐỎ: Chỉ lấy các chữ số màu ĐEN biểu thị số mét khối (m³). TUYỆT ĐỐI BỎ chữ số màu ĐỎ thập phân ở cuối cùng bên phải!
   - Ví dụ: Dãy số con lăn là [1] [0] [3] [9] [0 đỏ] -> Chỉ số m³ cần lấy là 1039 (bỏ số 0 màu đỏ).
   - Ví dụ: Dãy số là [0] [4] [5] [2] [8 đỏ] -> Chỉ số m³ cần lấy là 452.
3. TUYỆT ĐỐI BỎ QUA:
   - Các số hiệu kiểm định, số seri (ví dụ MC 00000465, S/N...).
   - Tên model (ví dụ LXS-15E, DN15...).
   - Các mặt kim tròn nhỏ phụ bên dưới (x0.0001, x0.001...).
4. ĐỊNH DẠNG ĐẦU RA: Trả về duy nhất một chuỗi JSON hợp lệ với cấu trúc sau, không kèm bất kỳ giải thích nào khác ngoài JSON:
{"reading": 1039, "full_digits": "10390", "has_red_digit": true, "note": "Đã lấy 1039 m³ (bỏ số đỏ 0 ở cuối)"}`
                : `Bạn là chuyên gia thị giác máy tính đọc chỉ số CÔNG TƠ ĐIỆN 1 pha tại Việt Nam (như EMIC, Gelex...).
Nhiệm vụ: Đọc chỉ số điện tiêu thụ (kWh nguyên) trên mặt công tơ trong ảnh để tính tiền phòng trọ.

QUY TẮC BẮT BUỘC:
1. DÃY HỘP SỐ CON LĂN: Đọc dãy chữ số hiển thị chỉ số kWh.
2. BỎ CHỮ SỐ THẬP PHÂN: Ô cuối cùng bên phải có viền đỏ hoặc chữ số màu đỏ là phần thập phân (0.1 kWh). TUYỆT ĐỐI BỎ QUA chữ số màu đỏ này, CHỈ LẤY CÁC CHỮ SỐ MÀU ĐEN (số nguyên kWh).
   - Ví dụ: Dãy số là 0 1 2 4 8 [5 đỏ] -> Chỉ số cần lấy là 1248.
3. TUYỆT ĐỐI BỎ QUA:
   - Số seri công tơ (No. 01234567...).
   - Thông số kỹ thuật (220V, 5(20)A, 450v/kWh...).
4. ĐỊNH DẠNG ĐẦU RA: Trả về duy nhất một chuỗi JSON hợp lệ với cấu trúc sau, không kèm bất kỳ giải thích nào khác ngoài JSON:
{"reading": 1248, "full_digits": "12485", "has_red_digit": true, "note": "Đã lấy 1248 kWh (bỏ số thập phân viền đỏ)"}`;

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                        ]
                    }]
                })
            });

            if (!res.ok) throw new Error('Gemini API HTTP ' + res.status);
            const resJson = await res.json();
            const textResult = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
            
            let parsedResult = null;
            const jsonMatch = textResult.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsedResult = JSON.parse(jsonMatch[0]);
                } catch (e) {}
            }

            let primaryVal = null;
            let fullDigitsVal = null;
            let noteMsg = '';

            if (parsedResult && typeof parsedResult.reading === 'number') {
                primaryVal = parsedResult.reading;
                if (parsedResult.full_digits) fullDigitsVal = parseInt(parsedResult.full_digits, 10);
                noteMsg = parsedResult.note || '';
            } else {
                const match = textResult.match(/\d+/);
                if (match) {
                    primaryVal = parseInt(match[0], 10);
                }
            }

            if (primaryVal !== null && !isNaN(primaryVal)) {
                renderOcrCandidates(primaryVal, fullDigitsVal, noteMsg);
                msgEl.textContent = '✅ Đã nhận diện bằng Gemini AI!';
                return;
            }
        } catch (e) {
            console.warn('Gemini Vision thất bại, tự động chuyển sang Tesseract OCR:', e);
            msgEl.textContent = '⚠️ AI bận, chuyển sang Tesseract OCR...';
        }
    }

    // === OPTION 2: TESSERACT.JS OCR (Chạy Offline trên máy) ===
    try {
        if (!window.Tesseract) {
            throw new Error('Thư viện Tesseract chưa sẵn sàng.');
        }

        msgEl.textContent = '⚙️ Đang quét bằng Tesseract OCR...';

        // 1. Cắt vùng con lăn ROI (ở giữa ảnh, tránh số seri MC và model phía trên)
        const roiCanvas = extractRollerRoi(canvas);

        // 2. Tiền xử lý tăng cường tương phản & lọc số đỏ nếu là đồng hồ nước
        const procCanvas = preprocessCanvasForOcr(roiCanvas, isWater);

        const result = await window.Tesseract.recognize(procCanvas, 'eng', {
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: '7'
        });

        const rawText = result.data?.text || '';
        console.log('Tesseract ROI text:', rawText);

        const candidates = extractMeterCandidates(rawText, isWater);
        if (candidates.length > 0) {
            const best = candidates[0];
            renderOcrCandidates(best.primary, best.full, best.note, candidates);
            msgEl.textContent = '✅ Nhận diện xong! Kiểm tra lại trước khi điền.';
            return;
        }

        // Thử lại lần 2 với toàn bộ ảnh (không cắt ROI)
        const fullProc = preprocessCanvasForOcr(canvas, false);
        const retryResult = await window.Tesseract.recognize(fullProc, 'eng', {
            tessedit_char_whitelist: '0123456789'
        });
        const retryCandidates = extractMeterCandidates(retryResult.data?.text || '', isWater);
        if (retryCandidates.length > 0) {
            const best = retryCandidates[0];
            renderOcrCandidates(best.primary, best.full, best.note, retryCandidates);
            msgEl.textContent = '✅ Nhận diện xong! Kiểm tra lại trước khi điền.';
            return;
        }

        msgEl.textContent = '⚠️ Không đọc rõ chữ số. Hãy kiểm tra hoặc nhập tay số bên dưới.';
        inputVal.value = '';
        resultArea.classList.remove('hidden');
    } catch (err) {
        console.error('Lỗi OCR:', err);
        msgEl.textContent = '❌ Lỗi nhận diện: ' + err.message;
        inputVal.value = '';
        resultArea.classList.remove('hidden');
    }
}

// Cắt vùng con lăn số ở dải ngang giữa ảnh
function extractRollerRoi(srcCanvas) {
    const roi = document.createElement('canvas');
    // Con lăn số thường nằm ở khoảng Y: 30% - 68%, X: 8% - 92%
    const cropX = Math.floor(srcCanvas.width * 0.08);
    const cropY = Math.floor(srcCanvas.height * 0.30);
    const cropW = Math.floor(srcCanvas.width * 0.84);
    const cropH = Math.floor(srcCanvas.height * 0.38);

    roi.width = cropW;
    roi.height = cropH;
    const ctx = roi.getContext('2d');
    ctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return roi;
}

// Tiền xử lý ảnh: Tăng tương phản & lọc số đỏ cho đồng hồ nước
function preprocessCanvasForOcr(srcCanvas, filterRed = false) {
    const canvas = document.createElement('canvas');
    canvas.width = srcCanvas.width;
    canvas.height = srcCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let minGray = 255, maxGray = 0;
    const grays = new Float32Array(canvas.width * canvas.height);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Nếu lọc đỏ (đồng hồ nước): biến pixel đỏ thành trắng nền (loại bỏ chữ số đỏ cuối)
        if (filterRed && r > 120 && r > g * 1.25 && r > b * 1.25) {
            grays[j] = 255;
        } else {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            grays[j] = gray;
            if (gray < minGray) minGray = gray;
            if (gray > maxGray) maxGray = gray;
        }
    }

    // Kéo giãn tương phản
    const range = Math.max(1, maxGray - minGray);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const norm = ((grays[j] - minGray) / range) * 255;
        const val = norm < 110 ? 0 : (norm > 160 ? 255 : norm);
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

// Phân tích các chuỗi số & trích xuất các ứng viên chỉ số
function extractMeterCandidates(rawText, isWater) {
    const rawMatches = rawText.match(/\d+/g) || [];
    const validMatches = [];

    for (const str of rawMatches) {
        // Bỏ các chuỗi số seri có từ 3 số 0 liên tiếp ở đầu (như MC 00000465)
        if (/^000/.test(str)) continue;
        // Bỏ các số nhỏ tách rời như 15 trong LXS-15E
        if (str.length < 3) continue;
        validMatches.push(str);
    }

    const candidates = [];
    for (const str of validMatches) {
        const fullNum = parseInt(str, 10);
        if (isNaN(fullNum)) continue;

        if (isWater) {
            // Đồng hồ nước: Nếu 5 chữ số -> thường là 4 số đen + 1 số đỏ (vd: 10390 -> 1039)
            if (str.length === 5) {
                const primary = Math.floor(fullNum / 10);
                candidates.push({
                    primary,
                    full: fullNum,
                    note: `💧 Đã tự động lấy ${primary} m³ (bỏ số đỏ ${str[4]} ở cuối)`
                });
            } else if (str.length === 4) {
                candidates.push({
                    primary: fullNum,
                    full: fullNum,
                    note: `💧 Đã nhận diện ${fullNum} m³`
                });
            } else if (str.length === 6) {
                const primary = Math.floor(fullNum / 10);
                candidates.push({
                    primary,
                    full: fullNum,
                    note: `💧 Đã tự động lấy ${primary} m³ (bỏ số đỏ ở cuối)`
                });
            } else {
                candidates.push({
                    primary: fullNum,
                    full: fullNum,
                    note: `💧 Số đọc được: ${fullNum}`
                });
            }
        } else {
            // Công tơ điện: Nếu từ 5 chữ số trở lên có chữ số thập phân viền đỏ
            if (str.length >= 5) {
                const primary = Math.floor(fullNum / 10);
                candidates.push({
                    primary,
                    full: fullNum,
                    note: `⚡ Đã tự động lấy ${primary} kWh (bỏ số đỏ ở cuối)`
                });
            } else {
                candidates.push({
                    primary: fullNum,
                    full: fullNum,
                    note: `⚡ Số điện: ${fullNum} kWh`
                });
            }
        }
    }
    return candidates;
}

// Hiển thị kết quả & các nút chọn nhanh
function renderOcrCandidates(primaryVal, fullVal, noteMsg, allCandidates = []) {
    const inputVal = $('#ocr-scanned-value');
    const resultArea = $('#ocr-result-area');
    const noteEl = $('#ocr-result-note');
    const suggEl = $('#ocr-suggestions');

    inputVal.value = primaryVal;
    resultArea.classList.remove('hidden');

    if (noteMsg && noteEl) {
        noteEl.textContent = noteMsg;
        noteEl.classList.remove('hidden');
    } else if (noteEl) {
        noteEl.classList.add('hidden');
    }

    if (!suggEl) return;
    suggEl.innerHTML = '';
    const isWater = CURRENT_OCR.meterType === 'water';
    const chips = [];

    // Chip chính: số khối nguyên (bỏ số đỏ)
    chips.push({
        val: primaryVal,
        label: isWater ? `🎯 ${primaryVal} (Số khối m³)` : `🎯 ${primaryVal} (Số điện kWh)`,
        active: true
    });

    // Chip phụ: số đầy đủ cả số đỏ (nếu khác số chính)
    if (fullVal && fullVal !== primaryVal) {
        chips.push({
            val: fullVal,
            label: `🔢 ${fullVal} (Cả số đỏ)`,
            active: false
        });
    }

    // Các ứng viên khác nếu có
    if (Array.isArray(allCandidates)) {
        for (const c of allCandidates) {
            if (!chips.some(chip => chip.val === c.primary)) {
                chips.push({
                    val: c.primary,
                    label: `🔢 ${c.primary}`,
                    active: false
                });
            }
        }
    }

    chips.forEach(chip => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ocr-chip' + (chip.active ? ' active' : '');
        btn.textContent = chip.label;
        btn.onclick = () => {
            inputVal.value = chip.val;
            suggEl.querySelectorAll('.ocr-chip').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
        };
        suggEl.appendChild(btn);
    });
}

function updateActiveChip(val) {
    const suggEl = $('#ocr-suggestions');
    if (!suggEl) return;
    suggEl.querySelectorAll('.ocr-chip').forEach(el => {
        if (el.textContent.includes(String(val))) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function applyOcrResult() {
    const val = parseFloat($('#ocr-scanned-value').value);
    if (isNaN(val) || val < 0) {
        toast('⚠️ Vui lòng nhập số hợp lệ!');
        return;
    }

    const inputId = CURRENT_OCR.meterType === 'elec' ? `#eNew-${CURRENT_OCR.roomId}` : `#wNew-${CURRENT_OCR.roomId}`;
    const targetInput = $(inputId);

    if (targetInput) {
        targetInput.value = val;
        // Kích hoạt sự kiện input để tính ngay số tiền phòng
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Hiệu ứng highlight màu xanh
        targetInput.style.borderColor = 'var(--success)';
        targetInput.style.boxShadow = '0 0 0 3px rgba(34, 197, 94, 0.25)';
        setTimeout(() => {
            targetInput.style.borderColor = '';
            targetInput.style.boxShadow = '';
        }, 1500);

        const room = APP.rooms.find(r => r.id === CURRENT_OCR.roomId);
        toast(`✅ Đã điền ${fmt(val)} vào ô ${CURRENT_OCR.meterType === 'elec' ? 'Điện' : 'Nước'} (${room ? room.name : ''})`);
        closeOcrScanner();
    }
}

// Globals for onclick handlers in HTML
window.showReceipt = showReceipt;
window.deletePeriod = deletePeriod;
window.removeRoom = removeRoom;
window.togglePeriod = togglePeriod;
window.openOcrScanner = openOcrScanner;
window.closeOcrScanner = closeOcrScanner;
window.applyOcrResult = applyOcrResult;
window.exportBackupJson = exportBackupJson;
window.exportHistoryCsv = exportHistoryCsv;
window.toggleComparisonView = toggleComparisonView;

