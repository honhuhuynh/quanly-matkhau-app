import { VaultManager } from './vault';
import type { VaultItem, SubAccount, ItemType } from './types';

let currentFilter: 'passwords' | 'notes' | 'favorites' | 'trash' = 'passwords';
let editItemId: string | null = null;
let vaultManager: VaultManager;
let currentSearchQuery = '';
let viewMode: 'card' | 'table' = 'card';

export function initUI(manager: VaultManager) {
    vaultManager = manager;
    setupEventListeners();
    renderItems();
}

function setupEventListeners() {
    // Navigation filters
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget as HTMLElement;
            target.classList.add('active');
            currentFilter = target.dataset.filter as any;
            renderItems();
        });
    });

    // Search logic
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.addEventListener('input', (e) => {
        currentSearchQuery = (e.target as HTMLInputElement).value;
        renderItems();
    });

    // View toggle
    const toggleViewBtn = document.getElementById('btn-toggle-view');
    toggleViewBtn?.addEventListener('click', () => {
        viewMode = viewMode === 'card' ? 'table' : 'card';
        toggleViewBtn.textContent = viewMode === 'card' ? '📋 Dạng Bảng' : '💳 Dạng Thẻ';
        renderItems();
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        
        if (e.key === '/') {
            e.preventDefault();
            searchInput.focus();
        } else if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            openModal();
        }
    });

    // Modal interactions
    document.getElementById('btn-add')?.addEventListener('click', () => openModal());
    document.getElementById('btn-cancel')?.addEventListener('click', closeModal);
    
    document.getElementById('item-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveItem();
    });

    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
        if (!editItemId) return;
        if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử mật khẩu của mục này? Lịch sử sẽ không thể khôi phục.')) return;
        
        vaultManager.updateItem(editItemId, { passwordHistory: [] } as any);
        document.getElementById('history-section')?.classList.add('hidden');
        showToast('Đã xóa toàn bộ lịch sử mật khẩu!');
    });

    document.getElementById('btn-add-sub-account')?.addEventListener('click', () => {
        addSubAccountRow();
    });

    document.getElementById('btn-bulk-change-pwd')?.addEventListener('click', () => {
        const newPwd = prompt('Nhập mật khẩu MỚI để áp dụng cho TẤT CẢ tài khoản trong danh sách dưới đây:\n(Để trống để hủy)');
        if (newPwd) {
            const inputs = document.querySelectorAll('.sa-password');
            inputs.forEach((input) => {
                (input as HTMLInputElement).value = newPwd;
                input.classList.add('flash');
                setTimeout(() => input.classList.remove('flash'), 500);
            });
            showToast(`Đã gán hàng loạt cho ${inputs.length} tài khoản. Bấm Lưu để lưu vào hệ thống.`);
        }
    });

    // Toggle forms based on type
    document.querySelectorAll('input[name="item-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const type = (e.target as HTMLInputElement).value;
            toggleFormFields(type);
        });
    });
}

function toggleFormFields(type: string) {
    const isNote = type === 'Note';
    const groupUrl = document.getElementById('group-url');
    const groupSubAcc = document.getElementById('group-sub-accounts');
    const notesInput = document.getElementById('item-notes') as HTMLTextAreaElement;
    const historySection = document.getElementById('history-section');
    
    if (isNote) {
        groupUrl?.classList.add('hidden');
        groupSubAcc?.classList.add('hidden');
        notesInput.classList.add('monospace');
        historySection?.classList.add('hidden');
    } else {
        groupUrl?.classList.remove('hidden');
        groupSubAcc?.classList.remove('hidden');
        notesInput.classList.remove('monospace');
        // Không gọi remove('hidden') cho historySection ở đây, vì việc hiển thị history 
        // sẽ do logic ở openModal quyết định dựa trên dữ liệu thật.
    }
}

function addSubAccountRow(sa?: SubAccount) {
    const container = document.getElementById('sub-accounts-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'sub-account-group';
    div.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
            <input type="hidden" class="sa-id" value="${sa ? escapeHTML(sa.id) : ''}" />
            <input type="text" placeholder="Tên (VD: Host)" class="sa-label" value="${sa ? escapeHTML(sa.label) : ''}" />
            <input type="text" placeholder="Tài khoản" class="sa-username" value="${sa ? escapeHTML(sa.username) : ''}" />
            <input type="password" placeholder="Mật khẩu" class="sa-password" value="${sa ? escapeHTML(sa.password) : ''}" />
            <button type="button" class="icon-btn btn-toggle-sa-pwd" title="Hiện/Ẩn MK">👁</button>
            <button type="button" class="icon-btn btn-del-sa" title="Xóa dòng này">🗑️</button>
        </div>
        <div style="width: 100%; margin-top: 4px;">
            <textarea placeholder="Ghi chú riêng / Mã dự phòng 2FA (nếu có)" class="sa-notes" rows="1" style="width: 100%; font-size: 11px; padding: 4px 8px; resize: vertical; min-height: 26px; border: 1px solid var(--input-border); background: var(--input-bg); color: var(--text-primary); border-radius: 4px;">${sa && sa.notes ? escapeHTML(sa.notes) : ''}</textarea>
        </div>
    `;
    div.querySelector('.btn-toggle-sa-pwd')?.addEventListener('click', () => {
        const pwdInput = div.querySelector('.sa-password') as HTMLInputElement;
        pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    });
    div.querySelector('.btn-del-sa')?.addEventListener('click', () => div.remove());
    container.appendChild(div);
}

function isFuzzyMatch(query: string, target: string): boolean {
    let qIdx = 0;
    let tIdx = 0;
    if (query.length === 0) return true;
    while (tIdx < target.length && qIdx < query.length) {
        if (query[qIdx] === target[tIdx]) qIdx++;
        tIdx++;
    }
    return qIdx === query.length;
}

function renderItems() {
    const list = document.getElementById('items-list');
    if (!list) return;

    list.innerHTML = '';
    
    let items = vaultManager.search(currentSearchQuery);

    // Nếu đang tìm kiếm, lọc hiển thị các sub-account để chỉ hiện những account khớp từ khóa
    if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase().replace(/\s+/g, '');
        items = items.map(i => {
            if (i.type === 'Note') return i;
            
            // Nếu tên nhóm hoặc tag khớp trực tiếp, giữ nguyên toàn bộ tài khoản
            const groupText = `${i.name} ${i.tags?.join(' ')} ${i.folder}`.toLowerCase();
            if (isFuzzyMatch(q, groupText)) return i;

            // Nếu chỉ có tài khoản phụ khớp, thì chỉ render tài khoản phụ đó
            const matchedSa = i.subAccounts?.filter(sa => 
                isFuzzyMatch(q, `${sa.label} ${sa.username}`.toLowerCase())
            ) || [];

            return { ...i, subAccounts: matchedSa };
        });
    }

    if (currentFilter === 'trash') {
        items = vaultManager.getVault().items.filter(i => i.deletedAt !== null);
    } else {
        items = items.filter(i => i.deletedAt === null);
        if (currentFilter === 'passwords') {
            items = items.filter(i => i.type !== 'Note');
        } else if (currentFilter === 'notes') {
            items = items.filter(i => i.type === 'Note');
        } else if (currentFilter === 'favorites') {
            // Lọc các item có đánh dấu sao ở Nhóm HOẶC có ít nhất 1 tài khoản con có đánh dấu sao
            items = items.filter(i => i.favorite || (i.subAccounts && i.subAccounts.some(sa => sa.favorite)));
            
            // Clone item để chỉ render các tài khoản con được yêu thích
            items = items.map(i => {
                if (i.favorite || i.type === 'Note') return i;
                return {
                    ...i,
                    subAccounts: i.subAccounts?.filter(sa => sa.favorite) || []
                };
            });
        }
    }

    if (items.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary)">Không có dữ liệu phù hợp.</div>`;
        return;
    }

    if (viewMode === 'card') {
        renderCards(list, items);
    } else {
        renderTable(list, items);
    }
}

function renderCards(container: HTMLElement, items: VaultItem[]) {
    container.className = 'items-list';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card glass-panel';
        
        const isNote = item.type === 'Note';
        const subAccCount = item.subAccounts?.length || 0;
        const countText = isNote ? '📝 Ghi chú' : (subAccCount > 0 ? `${subAccCount} tài khoản` : 'Trống');

        card.innerHTML = `
            <div class="item-info">
                <h4>${escapeHTML(item.name)} <span style="font-size: 11px; background: var(--accent-color); color: white; padding: 2px 6px; border-radius: 10px; margin-left: 8px;">${countText}</span></h4>
                <p>${isNote ? escapeHTML(item.notes.substring(0, 100)) + (item.notes.length > 100 ? '...' : '') : escapeHTML(item.url || 'Chưa có thông tin')}</p>
            </div>
            <div class="item-actions">
                ${currentFilter === 'trash' ? `
                    <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                    <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                ` : `
                    ${isNote ? `<button class="icon-btn btn-copy-note" title="Copy Nội dung Ghi chú">📋</button>` : ''}
                    <button class="icon-btn btn-fav" title="${item.favorite ? 'Bỏ Yêu thích' : 'Thêm vào Yêu thích'}">${item.favorite ? '⭐' : '☆'}</button>
                    <button class="icon-btn btn-edit" title="Xem/Sửa chi tiết">✏️</button>
                    <button class="icon-btn btn-del" title="Xóa">🗑️</button>
                `}
            </div>
        `;
        attachCardEvents(card, item);
        container.appendChild(card);
    });
}

function renderTable(container: HTMLElement, items: VaultItem[]) {
    container.className = '';
    const table = document.createElement('table');
    table.className = 'items-table glass-panel';
    table.innerHTML = `
        <thead>
            <tr>
                <th>${currentFilter === 'notes' ? 'Tiêu đề Ghi chú' : 'Tên Nhóm / Tiêu đề'}</th>
                <th>${currentFilter === 'notes' ? 'Trích đoạn nội dung' : 'Thông tin / Tài khoản'}</th>
                <th style="width: 170px;">Hành động</th>
            </tr>
        </thead>
        <tbody id="table-body"></tbody>
    `;
    container.appendChild(table);
    const tbody = table.querySelector('#table-body')!;

    items.forEach(item => {
        const isNote = item.type === 'Note';
        const trGroup = document.createElement('tr');
        
        if (isNote && currentFilter === 'notes') {
            trGroup.innerHTML = `
                <td><strong>📝 ${escapeHTML(item.name)}</strong></td>
                <td style="color: var(--text-secondary); font-family: monospace; font-size: 12px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${escapeHTML(item.notes.replace(/\n/g, ' '))}
                </td>
                <td>
                    <div class="item-actions">
                        ${currentFilter === 'trash' ? `
                            <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                            <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                        ` : `
                            <button class="icon-btn btn-copy-note" title="Copy Nội dung Ghi chú">📋</button>
                            <button class="icon-btn btn-fav" title="${item.favorite ? 'Bỏ Yêu thích' : 'Thêm vào Yêu thích'}">${item.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-edit" title="Xem/Sửa">✏️</button>
                            <button class="icon-btn btn-del" title="Xóa Ghi chú">🗑️</button>
                        `}
                    </div>
                </td>
            `;
        } else {
            trGroup.innerHTML = `
                <td colspan="2"><strong>${isNote ? '📝' : '📁'} ${escapeHTML(item.name)}</strong> <span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">(${isNote ? 'Ghi chú' : (item.subAccounts?.length || 0) + ' tài khoản'})</span></td>
                <td>
                    <div class="item-actions">
                        ${currentFilter === 'trash' ? `
                            <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                            <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                        ` : `
                            ${isNote ? `<button class="icon-btn btn-copy-note" title="Copy Nội dung Ghi chú">📋</button>` : ''}
                            <button class="icon-btn btn-fav" title="${item.favorite ? 'Bỏ Yêu thích' : 'Thêm vào Yêu thích'}">${item.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-edit" title="Xem/Sửa">✏️</button>
                            <button class="icon-btn btn-del" title="Xóa ${isNote ? 'Ghi chú' : 'toàn bộ nhóm'}">🗑️</button>
                        `}
                    </div>
                </td>
            `;
        }
        
        attachCardEvents(trGroup, item);
        tbody.appendChild(trGroup);

        // Sub Accounts Rows
        if (!isNote && item.subAccounts && item.subAccounts.length > 0 && currentFilter !== 'trash') {
            item.subAccounts.forEach(sa => {
                const trSub = document.createElement('tr');
                trSub.className = 'sub-account-row';
                trSub.innerHTML = `
                    <td>↳ <i>${escapeHTML(sa.label)}</i></td>
                    <td>${escapeHTML(sa.username)}</td>
                    <td>
                        <div class="item-actions">
                            <button class="icon-btn btn-fav-sa" title="${sa.favorite ? 'Bỏ Yêu thích' : 'Thêm vào Yêu thích'}">${sa.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-copy-sa-user" title="Copy Username">👤</button>
                            <button class="icon-btn btn-copy-sa-pwd" title="Copy Mật khẩu">🔑</button>
                        </div>
                    </td>
                `;
                trSub.querySelector('.btn-fav-sa')?.addEventListener('click', () => {
                    const idx = item.subAccounts!.findIndex(s => s.id === sa.id);
                    if (idx > -1) {
                        item.subAccounts![idx].favorite = !sa.favorite;
                        vaultManager.updateItem(item.id, { subAccounts: item.subAccounts });
                        renderItems();
                        showToast(!sa.favorite ? "Đã Yêu thích tài khoản" : "Đã bỏ Yêu thích");
                    }
                });
                trSub.querySelector('.btn-copy-sa-user')?.addEventListener('click', () => copyToClipboard(sa.username));
                trSub.querySelector('.btn-copy-sa-pwd')?.addEventListener('click', () => copyToClipboard(sa.password));
                tbody.appendChild(trSub);
            });
        }
    });
}

function attachCardEvents(el: HTMLElement, item: VaultItem) {
    if (currentFilter !== 'trash') {
        el.querySelector('.btn-fav')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.updateItem(item.id, { favorite: !item.favorite });
            renderItems();
            showToast(!item.favorite ? "Đã thêm vào Yêu thích" : "Đã xóa khỏi Yêu thích");
        });
        el.querySelector('.btn-copy-note')?.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(item.notes);
        });
        el.querySelector('.btn-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal(item);
        });
        el.querySelector('.btn-del')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.moveToTrash(item.id);
            renderItems();
            showToast("Đã chuyển vào thùng rác");
        });
    } else {
        el.querySelector('.btn-restore')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.restoreFromTrash(item.id);
            renderItems();
            showToast("Đã khôi phục");
        });
        el.querySelector('.btn-hard-del')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if(confirm('CẢNH BÁO: Xóa vĩnh viễn mục này sẽ không thể khôi phục. Bạn chắc chứ?')) {
                vaultManager.permanentlyDelete(item.id);
                renderItems();
            }
        });
    }
}

function openModal(item?: VaultItem) {
    const modal = document.getElementById('item-modal');
    const form = document.getElementById('item-form') as HTMLFormElement;
    document.getElementById('modal-title')!.textContent = item ? 'Sửa Mục' : 'Thêm Mới';
    
    form.reset();
    document.getElementById('sub-accounts-container')!.innerHTML = '';

    let isNote = false;

    if (item) {
        editItemId = item.id;
        isNote = item.type === 'Note';
        
        (document.querySelector(`input[name="item-type"][value="${isNote ? 'Note' : 'Account'}"]`) as HTMLInputElement).checked = true;
        (document.getElementById('item-name') as HTMLInputElement).value = item.name;
        (document.getElementById('item-url') as HTMLInputElement).value = item.url || '';
        (document.getElementById('item-notes') as HTMLTextAreaElement).value = item.notes;
        
        let accountsToRender = item.subAccounts ? [...item.subAccounts] : [];
        if (item.username || item.password) {
            if (accountsToRender.length === 0) {
                 accountsToRender.push({ id: crypto.randomUUID(), label: 'Mặc định', username: item.username, password: item.password });
            }
        }
        accountsToRender.forEach(sa => addSubAccountRow(sa));

        const historySection = document.getElementById('history-section');
        const historyList = document.getElementById('password-history-list');
        if (item.passwordHistory && item.passwordHistory.length > 0) {
            historySection?.classList.remove('hidden');
            if (historyList) {
                historyList.innerHTML = item.passwordHistory.map(h => `
                    <div class="history-item">
                        <span class="history-time">
                            ${new Date(h.changedAt).toLocaleString('vi-VN')}
                            <br><small style="color:var(--text-secondary)">↳ ${escapeHTML(h.targetLabel || 'Tài khoản chính')}</small>
                        </span>
                        <span class="history-pwd">${escapeHTML(h.password)}</span>
                    </div>
                `).join('');
            }
        } else {
            historySection?.classList.add('hidden');
        }
    } else {
        editItemId = null;
        document.getElementById('history-section')?.classList.add('hidden');
        (document.querySelector(`input[name="item-type"][value="Account"]`) as HTMLInputElement).checked = true;
        addSubAccountRow();
    }
    
    toggleFormFields(isNote ? 'Note' : 'Account');
    modal?.classList.remove('hidden');
    setTimeout(() => {
        (document.getElementById('item-name') as HTMLInputElement).focus();
    }, 100);
}

function closeModal() {
    document.getElementById('item-modal')?.classList.add('hidden');
    editItemId = null;
}

function saveItem() {
    const typeValue = (document.querySelector('input[name="item-type"]:checked') as HTMLInputElement).value;
    const name = (document.getElementById('item-name') as HTMLInputElement).value;
    const url = (document.getElementById('item-url') as HTMLInputElement).value;
    const notes = (document.getElementById('item-notes') as HTMLTextAreaElement).value;

    const existingItem = editItemId ? vaultManager.getVault().items.find(i => i.id === editItemId) : null;
    
    let subAccounts: SubAccount[] = [];
    
    if (typeValue === 'Account') {
        document.querySelectorAll('.sub-account-group').forEach(group => {
            const saId = (group.querySelector('.sa-id') as HTMLInputElement).value || crypto.randomUUID();
            const label = (group.querySelector('.sa-label') as HTMLInputElement).value;
            const saUser = (group.querySelector('.sa-username') as HTMLInputElement).value;
            const saPwd = (group.querySelector('.sa-password') as HTMLInputElement).value;
            const saNotes = (group.querySelector('.sa-notes') as HTMLTextAreaElement).value;
            if (label) {
                const oldSa = existingItem?.subAccounts?.find(s => s.id === saId);
                subAccounts.push({ id: saId, label, username: saUser, password: saPwd, notes: saNotes, favorite: oldSa?.favorite || false });
            }
        });
    }

    if (editItemId) {
        vaultManager.updateItem(editItemId, { 
            name, username: "", password: "", url, notes, subAccounts, type: typeValue as ItemType 
        });
        showToast("Đã cập nhật dữ liệu");
    } else {
        vaultManager.addItem({
            name, username: "", password: "", url, notes, subAccounts,
            type: typeValue as ItemType, tags: [], folder: '', favorite: false, customFields: [], expiresAt: null
        });
        showToast("Đã lưu mục mới");
    }

    closeModal();
    renderItems();
}

let clipboardTimeout: number;
async function copyToClipboard(text: string) {
    if (!text) {
        showToast("Trống!");
        return;
    }
    await navigator.clipboard.writeText(text);
    showToast("Đã copy (Tự động xóa sau 20s)");

    clearTimeout(clipboardTimeout);
    clipboardTimeout = window.setTimeout(async () => {
        try {
            await navigator.clipboard.writeText('');
            showToast("Đã tự động xóa clipboard");
        } catch (e) {
            console.error(e);
        }
    }, 20000);
}

function showToast(msg: string) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function escapeHTML(str: string) {
    if (!str) return '';
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}
