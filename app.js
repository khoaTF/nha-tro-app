// ========== SUPABASE CONNECTION ==========
const SUPABASE_URL = 'https://gsbuxzftnpkuizaujjiv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnV4emZ0bnBrdWl6YXVqaml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDU0NTIsImV4cCI6MjA5MzA4MTQ1Mn0.djsWFLZJkhEXtEqsq2eu53pxvGF6HaLvPq1uKO2xMnc';

let sb = null; // Supabase client
let APP = { rooms: [], settings: {}, records: [] };

function getConfig() { return JSON.parse(localStorage.getItem('nhatro_config') || 'null') || { url: SUPABASE_URL, key: SUPABASE_KEY }; }
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
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.classList.add('hidden'), 300); }, 2200);
}

function showLoading(show) {
    $('#loading-overlay').classList.toggle('hidden', !show);
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
        sb.from('settings').select('*').eq('id', 1).single(),
        sb.from('records').select('*').order('created_at')
    ]);
    if (roomsRes.error) throw roomsRes.error;
    APP.rooms = (roomsRes.data || []).map(r => ({ id: r.id, name: r.name, roomFee: r.room_fee, sortOrder: r.sort_order }));
    const s = settingsRes.data;
    APP.settings = s ? { elecPrice: s.elec_price, waterPrice: s.water_price, waterPriceOver: s.water_price_over, garbageFee: s.garbage_fee } : { elecPrice: 3000, waterPrice: 11000, waterPriceOver: 12000, garbageFee: 10000 };
    APP.records = recordsRes.data || [];
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
            $(`#tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'history') renderHistory();
            if (btn.dataset.tab === 'settings') renderSettings();
            if (btn.dataset.tab === 'entry') renderEntry();
        });
    });

    // Modal
    $('#close-modal').addEventListener('click', () => $('#receipt-modal').classList.add('hidden'));
    $('#receipt-modal').addEventListener('click', e => { if (e.target === $('#receipt-modal')) $('#receipt-modal').classList.add('hidden'); });
    $('#download-btn').addEventListener('click', downloadReceipt);
    $('#share-btn').addEventListener('click', shareReceipt);

    // Entry
    $('#save-period-btn').addEventListener('click', savePeriod);

    // Settings
    $('#save-settings-btn').addEventListener('click', saveSettings);
    $('#add-room-btn').addEventListener('click', addRoom);
    $('#disconnect-btn').addEventListener('click', () => {
        localStorage.removeItem('nhatro_config');
        location.reload();
    });

    // Setup
    $('#setup-connect-btn').addEventListener('click', connectSupabase);

    // Check config
    const cfg = getConfig();
    if (cfg) {
        initClient(cfg.url, cfg.key);
        bootApp();
    } else {
        $('#setup-screen').classList.remove('hidden');
    }
});

async function connectSupabase() {
    const url = $('#setup-url').value.trim();
    const key = $('#setup-key').value.trim();
    const errEl = $('#setup-error');
    errEl.textContent = '';

    if (!url || !key) { errEl.textContent = 'Vui lòng nhập đầy đủ URL và Key'; return; }

    const btn = $('#setup-connect-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Đang kết nối...';

    try {
        initClient(url, key);
        // Test connection
        const { error } = await sb.from('settings').select('id').eq('id', 1).single();
        if (error) throw error;

        setConfig({ url, key });
        $('#setup-screen').classList.add('hidden');
        await bootApp();
    } catch (e) {
        errEl.textContent = '❌ Không kết nối được. Kiểm tra URL và Key.\n' + (e.message || '');
        sb = null;
    }
    btn.disabled = false;
    btn.textContent = '🚀 Kết Nối';
}

async function bootApp() {
    showLoading(true);
    try {
        await loadAllData();
        autoFillDates();
        renderEntry();
        const cfg = getConfig();
        if (cfg) $('#connection-info').textContent = '✅ ' + cfg.url;
    } catch (e) {
        console.error(e);
        toast('❌ Lỗi tải dữ liệu');
    }
    showLoading(false);
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
    container.innerHTML = '';
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
                <input type="number" id="eNew-${room.id}" placeholder="Số mới" data-room="${room.id}" data-type="entry">
            </div>
            <div class="meter-row">
                <span class="meter-label">💧</span>
                <input type="number" class="readonly" id="wOld-${room.id}" value="${prev.water}" readonly tabindex="-1">
                <span class="arrow">→</span>
                <input type="number" id="wNew-${room.id}" placeholder="Số mới" data-room="${room.id}" data-type="entry">
            </div>`;
        container.appendChild(card);
    });

    // Live preview
    container.querySelectorAll('input[data-type="entry"]').forEach(inp => {
        inp.addEventListener('input', () => {
            const rid = inp.dataset.room;
            const room = APP.rooms.find(r => r.id === rid);
            const eOld = parseFloat($(`#eOld-${rid}`).value) || 0;
            const eNew = parseFloat($(`#eNew-${rid}`).value) || 0;
            const wOld = parseFloat($(`#wOld-${rid}`).value) || 0;
            const wNew = parseFloat($(`#wNew-${rid}`).value) || 0;
            if (eNew > 0 || wNew > 0) {
                const c = calcRoom({ elecOld: eOld, elecNew: eNew, waterOld: wOld, waterNew: wNew }, APP.settings, room);
                $(`#preview-${rid}`).textContent = fmt(c.finalTotal) + ' đ';
            } else {
                $(`#preview-${rid}`).textContent = '';
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
    if (!confirm(`Xoá ${room?.name}?`)) return;
    try {
        const { error } = await sb.from('rooms').delete().eq('id', id);
        if (error) throw error;
        await loadAllData();
        renderSettings();
        toast('🗑️ Đã xoá ' + (room?.name || ''));
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

// Globals for onclick handlers in HTML
window.showReceipt = showReceipt;
window.deletePeriod = deletePeriod;
window.removeRoom = removeRoom;
window.togglePeriod = togglePeriod;
