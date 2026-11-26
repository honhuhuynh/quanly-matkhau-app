import { VaultManager, matchesSearchText, normalizeVietnamese, type PasswordHealthSummary } from './vault';
import {
    CATEGORY_OPTIONS,
    resolveItemCategory,
    type VaultItem,
    type SubAccount,
    type ItemType,
    type ItemCategory
} from './types';
import { generateStrongPassword, isWeakPassword } from './crypto';
import { setSyncStatusListener, type SyncState } from './storage';
import type { SessionActions } from './auth';

type NavFilter = 'all' | 'passwords' | 'notes' | 'favorites' | 'health' | 'trash';
type CatFilter = 'all' | ItemCategory;

let currentFilter: NavFilter = 'all';
let currentCatFilter: CatFilter = 'all';
let currentSearchQuery = '';
let viewMode: 'card' | 'table' = 'card';
let editItemId: string | null = null;
let vaultManager: VaultManager;
let sessionRef: SessionActions | null = null;
let uiListenersInitialized = false;

const expandedGroupIds = new Set<string>();
const revealedSubPwdIds = new Set<string>();
let historyRevealed = false;
let pendingImportRawText = '';

let toastTimer: number | undefined;
let clipboardTimeout: number | undefined;

export function showGlobalToast(msg: string, kind: 'success' | 'error' | 'info' = 'success'): void {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = `toast ${kind}`;
    toastTimer = window.setTimeout(() => {
        toast.classList.add('hidden');
    }, 3200);
}

export function initUI(manager: VaultManager, session?: SessionActions): void {
    vaultManager = manager;
    if (session) sessionRef = session;

    expandedGroupIds.clear();
    revealedSubPwdIds.clear();
    currentSearchQuery = '';
    const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    document.getElementById('btn-clear-search')?.classList.add('hidden');

    updateSidebarSessionHeader();
    setupEventListenersOnce();
    renderItems();
}

function updateSidebarSessionHeader(): void {
    if (!sessionRef) return;
    const badgeName = document.getElementById('vault-badge-name');
    const badgeMode = document.getElementById('vault-badge-mode');
    if (badgeName) badgeName.textContent = `🔐 ${sessionRef.getVaultName()}`;
    if (badgeMode) {
        const isCloud = sessionRef.getStorageMode() === 'github';
        badgeMode.textContent = isCloud ? '☁️ Cloud GitHub' : '💾 Offline';
    }
}

function updateSyncBadgeUI(state: SyncState, detail?: string): void {
    const badge = document.getElementById('sync-status-badge');
    const text = document.getElementById('sync-status-text');
    if (!badge || !text) return;
    badge.className = `sync-status-badge ${state}`;
    text.textContent = detail || (state === 'saving' ? 'Đang lưu...' : state === 'saved' ? 'Đã đồng bộ' : state === 'error' ? 'Lỗi đồng bộ' : 'Offline');
}

function setupEventListenersOnce(): void {
    setSyncStatusListener((state, detail) => updateSyncBadgeUI(state, detail));

    sessionRef?.onAutoLockRemainingChange((secs) => {
        const el = document.getElementById('auto-lock-label');
        if (!el) return;
        const m = Math.floor(Math.max(0, secs) / 60);
        const s = Math.max(0, secs) % 60;
        el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    });

    if (uiListenersInitialized) return;
    uiListenersInitialized = true;

    // Sidebar filter buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget as HTMLElement;
            target.classList.add('active');
            currentFilter = (target.dataset.filter as NavFilter) || 'all';
            const catBar = document.getElementById('category-bar');
            if (catBar) {
                catBar.classList.toggle('hidden', currentFilter === 'notes' || currentFilter === 'health' || currentFilter === 'trash');
            }
            renderItems();
        });
    });

    // Category filter chips
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            const target = e.currentTarget as HTMLElement;
            target.classList.add('active');
            currentCatFilter = (target.dataset.cat as CatFilter) || 'all';
            renderItems();
        });
    });

    // Search box + clear
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const clearBtn = document.getElementById('btn-clear-search');
    searchInput?.addEventListener('input', () => {
        currentSearchQuery = searchInput.value;
        clearBtn?.classList.toggle('hidden', !currentSearchQuery);
        renderItems();
    });
    clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        currentSearchQuery = '';
        clearBtn.classList.add('hidden');
        renderItems();
        searchInput.focus();
    });

    // View mode switcher
    const btnCard = document.getElementById('btn-view-card');
    const btnTable = document.getElementById('btn-view-table');
    btnCard?.addEventListener('click', () => {
        viewMode = 'card';
        btnCard.classList.add('active');
        btnTable?.classList.remove('active');
        renderItems();
    });
    btnTable?.addEventListener('click', () => {
        viewMode = 'table';
        btnTable.classList.add('active');
        btnCard?.classList.remove('active');
        renderItems();
    });

    // Expand / collapse all visible groups
    document.getElementById('btn-expand-all')?.addEventListener('click', () => {
        const visible = getFilteredItems();
        const expandables = visible.filter(i => i.type !== 'Note' || i.notes.length > 0);
        const allOpen = expandables.length > 0 && expandables.every(i => expandedGroupIds.has(i.id));
        if (allOpen) {
            expandedGroupIds.clear();
        } else {
            expandables.forEach(i => expandedGroupIds.add(i.id));
        }
        renderItems();
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const topModals = ['import-modal', 'master-pwd-modal', 'bulk-pwd-modal', 'item-modal'];
            for (const id of topModals) {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) {
                    el.classList.add('hidden');
                    if (id === 'item-modal') editItemId = null;
                    return;
                }
            }
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
        const anyModalOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(m => !m.classList.contains('hidden'));
        if (anyModalOpen) return;

        if (e.key === '/') {
            e.preventDefault();
            searchInput?.focus();
        } else if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            openModal();
        }
    });

    // Lock / Sync / Change Master Pwd / Export / Import
    document.getElementById('btn-lock-vault')?.addEventListener('click', () => {
        sessionRef?.lockVault('Đã khóa két an toàn.');
    });

    document.getElementById('btn-sync')?.addEventListener('click', async () => {
        await sessionRef?.syncNow();
    });

    // Modal Item interactions
    document.getElementById('btn-add')?.addEventListener('click', () => openModal());
    document.getElementById('btn-cancel')?.addEventListener('click', closeModal);
    document.getElementById('btn-close-item-modal')?.addEventListener('click', closeModal);
    document.getElementById('item-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveItem();
    });

    document.getElementById('btn-open-item-url')?.addEventListener('click', () => {
        const val = (document.getElementById('item-url') as HTMLInputElement).value;
        openSafeExternalUrl(val);
    });

    document.getElementById('btn-add-sub-account')?.addEventListener('click', () => {
        addSubAccountRow();
    });

    document.querySelectorAll('input[name="item-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleFormFields((e.target as HTMLInputElement).value);
        });
    });

    document.getElementById('btn-toggle-history-vis')?.addEventListener('click', () => {
        historyRevealed = !historyRevealed;
        const btn = document.getElementById('btn-toggle-history-vis');
        if (btn) btn.textContent = historyRevealed ? '🙈 Ẩn tất cả' : '👁 Hiện tất cả';
        document.querySelectorAll('#password-history-list .history-pwd').forEach(el => {
            const raw = (el as HTMLElement).dataset.raw || '';
            el.textContent = historyRevealed ? raw : '••••••••••••';
        });
    });

    // Bulk password modal
    setupBulkModalEvents();

    // Change Master Password modal
    setupMasterPwdModalEvents();

    // Backup Export / Import modal
    setupBackupEvents();
}

function setupBulkModalEvents(): void {
    const bulkModal = document.getElementById('bulk-pwd-modal');
    const bulkInput = document.getElementById('bulk-pwd-input') as HTMLInputElement;
    const bulkList = document.getElementById('bulk-scope-list');
    const closeBulk = () => bulkModal?.classList.add('hidden');

    document.getElementById('btn-bulk-close')?.addEventListener('click', closeBulk);
    document.getElementById('btn-bulk-cancel')?.addEventListener('click', closeBulk);

    document.getElementById('btn-bulk-eye')?.addEventListener('click', (e) => {
        const showing = bulkInput.type === 'text';
        bulkInput.type = showing ? 'password' : 'text';
        (e.currentTarget as HTMLButtonElement).textContent = showing ? '👁' : '🙈';
    });

    document.getElementById('btn-bulk-gen-pwd')?.addEventListener('click', () => {
        bulkInput.value = generateStrongPassword({ length: 16 });
        bulkInput.type = 'text';
        const eyeBtn = document.getElementById('btn-bulk-eye');
        if (eyeBtn) eyeBtn.textContent = '🙈';
    });

    document.getElementById('btn-bulk-select-all')?.addEventListener('click', () => {
        bulkList?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            (cb as HTMLInputElement).checked = true;
        });
    });

    document.getElementById('btn-bulk-select-none')?.addEventListener('click', () => {
        bulkList?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            (cb as HTMLInputElement).checked = false;
        });
    });

    document.getElementById('btn-bulk-change-pwd')?.addEventListener('click', () => {
        const rows = Array.from(document.querySelectorAll('#sub-accounts-container .sub-account-group'));
        if (rows.length === 0) {
            showGlobalToast('Chưa có dòng tài khoản nào để đổi mật khẩu!', 'info');
            return;
        }
        if (bulkList) {
            bulkList.innerHTML = rows.map((row, idx) => {
                const label = (row.querySelector('.sa-label') as HTMLInputElement).value.trim() || `Dòng #${idx + 1}`;
                const user = (row.querySelector('.sa-username') as HTMLInputElement).value.trim();
                const pc = (row.querySelector('.sa-pc') as HTMLInputElement).value.trim();
                const desc = [pc, user].filter(Boolean).join(' • ');
                return `
                    <label class="bulk-scope-item">
                        <input type="checkbox" value="${idx}" checked />
                        <span><strong>${escapeHTML(label)}</strong>${desc ? ` <small>(${escapeHTML(desc)})</small>` : ''}</span>
                    </label>
                `;
            }).join('');
        }
        bulkInput.value = '';
        bulkInput.type = 'password';
        bulkModal?.classList.remove('hidden');
        setTimeout(() => bulkInput.focus(), 50);
    });

    document.getElementById('btn-bulk-apply')?.addEventListener('click', () => {
        const newPwd = bulkInput.value;
        if (!newPwd) {
            showGlobalToast('Vui lòng nhập hoặc bấm 🎲 tạo mật khẩu mới!', 'error');
            return;
        }
        const checkedIndices = new Set<number>();
        bulkList?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            checkedIndices.add(Number((cb as HTMLInputElement).value));
        });
        if (checkedIndices.size === 0) {
            showGlobalToast('Hãy chọn ít nhất 1 tài khoản!', 'info');
            return;
        }

        const rows = document.querySelectorAll('#sub-accounts-container .sub-account-group');
        let applied = 0;
        rows.forEach((row, idx) => {
            if (!checkedIndices.has(idx)) return;
            const input = row.querySelector('.sa-password') as HTMLInputElement | null;
            if (input) {
                input.value = newPwd;
                input.classList.add('flash');
                setTimeout(() => input.classList.remove('flash'), 600);
                applied++;
            }
        });
        closeBulk();
        showGlobalToast(`Đã cập nhật MK cho ${applied} tài khoản. Bấm Lưu lại để hoàn tất!`, 'success');
    });
}

function setupMasterPwdModalEvents(): void {
    const mpModal = document.getElementById('master-pwd-modal');
    const mpForm = document.getElementById('master-pwd-form') as HTMLFormElement;
    const mpErr = document.getElementById('mp-error');
    const closeMp = () => {
        mpModal?.classList.add('hidden');
        mpForm?.reset();
        mpErr?.classList.add('hidden');
    };

    document.getElementById('btn-change-master')?.addEventListener('click', () => {
        if (!sessionRef) return;
        mpForm?.reset();
        mpErr?.classList.add('hidden');
        (document.getElementById('mp-hint') as HTMLInputElement).value = sessionRef.getCurrentHint();
        mpModal?.classList.remove('hidden');
        setTimeout(() => (document.getElementById('mp-old') as HTMLInputElement).focus(), 50);
    });

    document.getElementById('btn-mp-close')?.addEventListener('click', closeMp);
    document.getElementById('btn-mp-cancel')?.addEventListener('click', closeMp);

    mpForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!sessionRef) return;
        const oldPwd = (document.getElementById('mp-old') as HTMLInputElement).value;
        const newPwd = (document.getElementById('mp-new') as HTMLInputElement).value;
        const confirmPwd = (document.getElementById('mp-confirm') as HTMLInputElement).value;
        const newHint = (document.getElementById('mp-hint') as HTMLInputElement).value.trim();

        if (newPwd !== confirmPwd) {
            if (mpErr) {
                mpErr.textContent = 'Mật khẩu mới xác nhận không khớp!';
                mpErr.classList.remove('hidden');
            }
            return;
        }
        try {
            await sessionRef.changeMasterPassword(oldPwd, newPwd, newHint);
            closeMp();
            showGlobalToast('Đã đổi Mật khẩu chủ và mã hóa lại toàn bộ két!', 'success');
        } catch (err: unknown) {
            if (mpErr) {
                mpErr.textContent = err instanceof Error ? err.message : 'Đổi mật khẩu thất bại';
                mpErr.classList.remove('hidden');
            }
        }
    });
}

function setupBackupEvents(): void {
    const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
    const importModal = document.getElementById('import-modal');
    const importForm = document.getElementById('import-form') as HTMLFormElement;
    const impErr = document.getElementById('imp-error');
    const closeImp = () => {
        importModal?.classList.add('hidden');
        importForm?.reset();
        impErr?.classList.add('hidden');
        pendingImportRawText = '';
    };

    document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
        if (!sessionRef) return;
        const { filename, content } = await sessionRef.exportEncryptedVault();
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showGlobalToast(`Đã tải file backup mã hóa: ${filename}`, 'success');
    });

    document.getElementById('btn-import-backup')?.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        pendingImportRawText = await file.text();
        const label = document.getElementById('imp-file-label');
        if (label) label.textContent = `File đã chọn: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        impErr?.classList.add('hidden');
        (document.getElementById('imp-pwd') as HTMLInputElement).value = '';
        importModal?.classList.remove('hidden');
        setTimeout(() => (document.getElementById('imp-pwd') as HTMLInputElement).focus(), 50);
    });

    document.getElementById('btn-imp-close')?.addEventListener('click', closeImp);
    document.getElementById('btn-imp-cancel')?.addEventListener('click', closeImp);

    importForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!sessionRef || !pendingImportRawText) return;
        const pwd = (document.getElementById('imp-pwd') as HTMLInputElement).value;
        const mode = (document.querySelector('input[name="import-mode"]:checked') as HTMLInputElement)?.value || 'merge';
        try {
            const importedItems = await sessionRef.decryptExternalBackup(pendingImportRawText, pwd);
            if (mode === 'replace') {
                vaultManager.getVault().items = importedItems;
            } else {
                const existingIds = new Set(vaultManager.getVault().items.map(i => i.id));
                for (const it of importedItems) {
                    if (existingIds.has(it.id)) {
                        it.id = crypto.randomUUID();
                    }
                    vaultManager.getVault().items.push(it);
                }
            }
            await sessionRef.commitManualSave();
            closeImp();
            renderItems();
            showGlobalToast(`Đã nhập thành công ${importedItems.length} mục từ backup!`, 'success');
        } catch (err: unknown) {
            if (impErr) {
                impErr.textContent = err instanceof Error ? err.message : 'Không giải mã được file backup!';
                impErr.classList.remove('hidden');
            }
        }
    });
}

function toggleFormFields(type: string): void {
    const isNote = type === 'Note';
    const groupUrl = document.getElementById('group-url');
    const groupCat = document.getElementById('group-category');
    const groupSubAcc = document.getElementById('group-sub-accounts');
    const notesInput = document.getElementById('item-notes') as HTMLTextAreaElement;
    const historySection = document.getElementById('history-section');

    if (isNote) {
        groupUrl?.classList.add('hidden');
        groupCat?.classList.add('hidden');
        groupSubAcc?.classList.add('hidden');
        notesInput.classList.add('monospace');
        historySection?.classList.add('hidden');
    } else {
        groupUrl?.classList.remove('hidden');
        groupCat?.classList.remove('hidden');
        groupSubAcc?.classList.remove('hidden');
        notesInput.classList.remove('monospace');
    }
}

function addSubAccountRow(sa?: SubAccount): void {
    const container = document.getElementById('sub-accounts-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'sub-account-group';
    div.innerHTML = `
        <input type="hidden" class="sa-id" value="${sa ? escapeHTML(sa.id) : ''}" />
        <input type="hidden" class="sa-fav-val" value="${sa?.favorite ? '1' : '0'}" />
        <div class="sa-row-top">
            <input type="text" placeholder="Tên nhân sự / Nhãn (VD: Nguyễn Minh Lý)" class="sa-label" value="${sa ? escapeHTML(sa.label) : ''}" />
            <input type="text" placeholder="Mã máy (VD: ARC-HP01)" class="sa-pc" value="${sa?.pcCode ? escapeHTML(sa.pcCode) : ''}" />
            <input type="text" placeholder="Tài khoản / Email" class="sa-username" value="${sa ? escapeHTML(sa.username) : ''}" />
            <button type="button" class="icon-btn btn-fav-form" title="Đánh dấu Yêu thích">${sa?.favorite ? '⭐' : '☆'}</button>
            <button type="button" class="icon-btn btn-del-sa" title="Xóa dòng này">🗑️</button>
        </div>
        <div class="sa-row-bottom">
            <div class="sa-pwd-wrap">
                <input type="password" placeholder="Mật khẩu" class="sa-password" value="${sa ? escapeHTML(sa.password) : ''}" />
                <button type="button" class="icon-btn btn-gen-sa-pwd" title="Sinh mật khẩu mạnh 16 ký tự">🎲</button>
                <button type="button" class="icon-btn btn-toggle-sa-pwd" title="Hiện/Ẩn MK">👁</button>
                <button type="button" class="icon-btn btn-copy-form-pwd" title="Copy MK">📋</button>
            </div>
            <input type="text" placeholder="Ghi chú / Mã dự phòng 2FA..." class="sa-notes" value="${sa?.notes ? escapeHTML(sa.notes) : ''}" />
        </div>
    `;

    const favHidden = div.querySelector('.sa-fav-val') as HTMLInputElement;
    const favBtn = div.querySelector('.btn-fav-form') as HTMLButtonElement;
    favBtn?.addEventListener('click', () => {
        const next = favHidden.value !== '1';
        favHidden.value = next ? '1' : '0';
        favBtn.textContent = next ? '⭐' : '☆';
    });

    const pwdInput = div.querySelector('.sa-password') as HTMLInputElement;
    div.querySelector('.btn-toggle-sa-pwd')?.addEventListener('click', (e) => {
        const showing = pwdInput.type === 'text';
        pwdInput.type = showing ? 'password' : 'text';
        (e.currentTarget as HTMLButtonElement).textContent = showing ? '👁' : '🙈';
    });
    div.querySelector('.btn-gen-sa-pwd')?.addEventListener('click', () => {
        pwdInput.value = generateStrongPassword({ length: 16 });
        pwdInput.type = 'text';
        const eyeBtn = div.querySelector('.btn-toggle-sa-pwd') as HTMLButtonElement | null;
        if (eyeBtn) eyeBtn.textContent = '🙈';
        pwdInput.classList.add('flash');
        setTimeout(() => pwdInput.classList.remove('flash'), 500);
    });
    div.querySelector('.btn-copy-form-pwd')?.addEventListener('click', () => copyToClipboard(pwdInput.value));
    div.querySelector('.btn-del-sa')?.addEventListener('click', () => div.remove());

    container.appendChild(div);
}

function updateSidebarCounts(health: PasswordHealthSummary): void {
    const active = vaultManager.getItems(false);
    const trash = vaultManager.getVault().items.filter(i => i.deletedAt !== null);
    const notesCount = active.filter(i => i.type === 'Note').length;
    const pwdGroupsCount = active.filter(i => i.type !== 'Note').length;
    const favCount = active.filter(i => i.favorite || (i.subAccounts || []).some(sa => sa.favorite)).length;

    const setTxt = (id: string, val: number) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    };
    setTxt('count-all', active.length);
    setTxt('count-passwords', pwdGroupsCount);
    setTxt('count-notes', notesCount);
    setTxt('count-favorites', favCount);
    setTxt('count-health', health.entries.length);
    setTxt('count-trash', trash.length);
}

function getFilteredItems(): VaultItem[] {
    if (currentFilter === 'trash') {
        return vaultManager.getVault().items.filter(i => i.deletedAt !== null);
    }

    let items = vaultManager.search(currentSearchQuery).filter(i => i.deletedAt === null);

    if (currentSearchQuery.trim()) {
        items = items.map(i => {
            if (i.type === 'Note') return i;
            const groupMatched = matchesSearchText(currentSearchQuery, i.name, i.url, i.notes, i.folder, i.tags.join(' '));
            if (groupMatched) return i;
            const matchedSa = vaultManager.getEffectiveSubAccounts(i).filter(sa =>
                matchesSearchText(currentSearchQuery, sa.label, sa.pcCode, sa.username, sa.notes)
            );
            return { ...i, subAccounts: matchedSa };
        });
    }

    if (currentFilter === 'passwords') {
        items = items.filter(i => i.type !== 'Note');
    } else if (currentFilter === 'notes') {
        items = items.filter(i => i.type === 'Note');
    } else if (currentFilter === 'favorites') {
        items = items
            .filter(i => i.favorite || (i.subAccounts && i.subAccounts.some(sa => sa.favorite)))
            .map(i => {
                if (i.favorite || i.type === 'Note') return i;
                return { ...i, subAccounts: (i.subAccounts || []).filter(sa => sa.favorite) };
            });
    }

    if (currentCatFilter !== 'all' && currentFilter !== 'notes') {
        items = items.filter(i => i.type !== 'Note' && resolveItemCategory(i) === currentCatFilter);
    }

    return items;
}

function renderItems(): void {
    const list = document.getElementById('items-list');
    if (!list) return;

    const health = vaultManager.analyzePasswordHealth();
    updateSidebarCounts(health);

    const expandAllBtn = document.getElementById('btn-expand-all');
    if (expandAllBtn) {
        expandAllBtn.classList.toggle('hidden', currentFilter === 'health' || currentFilter === 'trash');
    }

    list.innerHTML = '';

    if (currentFilter === 'health') {
        renderHealthView(list, health);
        return;
    }

    const items = getFilteredItems();

    // Cập nhật text nút Mở hết / Thu gọn
    if (expandAllBtn) {
        const expandables = items.filter(i => i.type !== 'Note' || i.notes.length > 0);
        const allOpen = expandables.length > 0 && expandables.every(i => expandedGroupIds.has(i.id));
        expandAllBtn.textContent = allOpen ? '📁 Thu gọn' : '📂 Mở hết';
    }

    if (items.length === 0) {
        list.innerHTML = `
            <div class="empty-state glass-panel">
                <div style="font-size: 36px; margin-bottom: 10px;">🔎</div>
                <p>Không tìm thấy mục nào phù hợp${currentSearchQuery ? ` cho "<strong>${escapeHTML(currentSearchQuery)}</strong>"` : ''}.</p>
                ${currentFilter !== 'trash' ? `<button type="button" class="action-btn primary" id="btn-empty-add" style="margin-top: 12px;">+ Thêm Mục Mới</button>` : ''}
            </div>
        `;
        document.getElementById('btn-empty-add')?.addEventListener('click', () => openModal());
        return;
    }

    if (viewMode === 'card') {
        renderCards(list, items, health);
    } else {
        renderTable(list, items, health);
    }
}

function getCategoryMeta(cat: ItemCategory) {
    return CATEGORY_OPTIONS.find(c => c.id === cat) || CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
}

function renderCards(container: HTMLElement, items: VaultItem[], health: PasswordHealthSummary): void {
    container.className = 'items-list';

    items.forEach(item => {
        const isNote = item.type === 'Note';
        const effectiveAccounts = isNote ? [] : vaultManager.getEffectiveSubAccounts(item);
        const isExpanded = expandedGroupIds.has(item.id) || (!!currentSearchQuery.trim() && !isNote && effectiveAccounts.length > 0);
        const cat = resolveItemCategory(item);
        const catMeta = getCategoryMeta(cat);

        // Kiểm tra xem nhóm có tài khoản dùng chung/yếu không
        const dupInGroup = effectiveAccounts.filter(sa => sa.password && (health.duplicatePasswordsCount.get(sa.password) || 0) > 1).length;
        const weakInGroup = effectiveAccounts.filter(sa => isWeakPassword(sa.password)).length;

        const card = document.createElement('div');
        card.className = `item-card-wrapper glass-panel ${isExpanded ? 'expanded' : ''}`;

        const countText = isNote ? '📝 Ghi chú' : `${effectiveAccounts.length} tài khoản`;
        const safeUrl = normalizeExternalUrl(item.url);

        card.innerHTML = `
            <div class="item-card-header" role="button" tabindex="0">
                <div class="item-info">
                    <div class="item-title-line">
                        <span class="chevron">${isExpanded ? '▾' : '▸'}</span>
                        <span class="cat-pill">${isNote ? '📝' : catMeta.icon}</span>
                        <h4>${highlightMatchHTML(item.name, currentSearchQuery)}</h4>
                        <span class="count-badge">${countText}</span>
                        ${dupInGroup > 0 ? `<span class="health-pill dup" title="Có tài khoản dùng trùng mật khẩu">🟠 Trùng MK (${dupInGroup})</span>` : ''}
                        ${weakInGroup > 0 ? `<span class="health-pill weak" title="Có mật khẩu yếu">🔴 Yếu (${weakInGroup})</span>` : ''}
                    </div>
                    <p class="item-subtitle">
                        ${isNote
                            ? highlightMatchHTML(item.notes.slice(0, 120) + (item.notes.length > 120 ? '...' : ''), currentSearchQuery)
                            : (item.url ? `<span class="url-text">${escapeHTML(item.url)}</span>` : '<span style="opacity:0.6">Nhấn để mở danh sách tài khoản</span>')}
                    </p>
                </div>
                <div class="item-actions">
                    ${currentFilter === 'trash' ? `
                        <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                        <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                    ` : `
                        ${safeUrl ? `<button class="icon-btn btn-open-url" title="Mở liên kết nhanh">🔗</button>` : ''}
                        ${isNote ? `<button class="icon-btn btn-copy-note" title="Copy toàn bộ nội dung">📋</button>` : ''}
                        <button class="icon-btn btn-fav" title="${item.favorite ? 'Bỏ Yêu thích' : 'Yêu thích nhóm này'}">${item.favorite ? '⭐' : '☆'}</button>
                        <button class="icon-btn btn-clone" title="Nhân bản nhóm">📑</button>
                        <button class="icon-btn btn-edit" title="Xem / Sửa chi tiết">✏️</button>
                        <button class="icon-btn btn-del" title="Chuyển vào thùng rác">🗑️</button>
                    `}
                </div>
            </div>
            <div class="item-card-body ${isExpanded ? '' : 'hidden'}"></div>
        `;

        // Mở/đóng accordion khi bấm tiêu đề thẻ
        const headerEl = card.querySelector('.item-card-header');
        headerEl?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.item-actions')) return;
            if (expandedGroupIds.has(item.id)) expandedGroupIds.delete(item.id);
            else expandedGroupIds.add(item.id);
            renderItems();
        });

        attachCardEvents(card, item, safeUrl);

        if (isExpanded) {
            const body = card.querySelector('.item-card-body') as HTMLElement;
            if (isNote) {
                body.innerHTML = `
                    <div class="note-preview-box">
                        <pre>${highlightMatchHTML(item.notes || '(Trống)', currentSearchQuery)}</pre>
                        <div class="note-preview-actions">
                            <button type="button" class="action-btn outline small-btn btn-note-body-copy">📋 Copy nội dung</button>
                            <button type="button" class="action-btn outline small-btn btn-note-body-edit">✏️ Sửa ghi chú</button>
                        </div>
                    </div>
                `;
                body.querySelector('.btn-note-body-copy')?.addEventListener('click', () => copyToClipboard(item.notes));
                body.querySelector('.btn-note-body-edit')?.addEventListener('click', () => openModal(item));
            } else {
                renderInlineSubAccountList(body, item, effectiveAccounts, health);
            }
        }

        container.appendChild(card);
    });
}

function renderInlineSubAccountList(
    container: HTMLElement,
    item: VaultItem,
    accounts: SubAccount[],
    health: PasswordHealthSummary
): void {
    if (accounts.length === 0) {
        container.innerHTML = `<div class="inline-empty">Chưa có tài khoản nào trong nhóm. <button type="button" class="link-btn btn-inline-add">+ Thêm ngay</button></div>`;
        container.querySelector('.btn-inline-add')?.addEventListener('click', () => openModal(item));
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'inline-sa-list';

    accounts.forEach(sa => {
        const dupCount = sa.password ? (health.duplicatePasswordsCount.get(sa.password) || 0) : 0;
        const weak = isWeakPassword(sa.password);
        const isRev = revealedSubPwdIds.has(sa.id);

        const row = document.createElement('div');
        row.className = 'inline-sa-row';
        row.innerHTML = `
            <div class="sa-col-who">
                <button type="button" class="star-mini-btn btn-sa-star" title="Yêu thích tài khoản này">${sa.favorite ? '⭐' : '☆'}</button>
                <div class="sa-name-stack">
                    <div class="sa-title-line">
                        <strong>${highlightMatchHTML(sa.label || 'Chưa đặt tên', currentSearchQuery)}</strong>
                        ${sa.pcCode ? `<span class="pc-badge">${highlightMatchHTML(sa.pcCode, currentSearchQuery)}</span>` : ''}
                    </div>
                    ${sa.notes ? `<div class="sa-note-snippet" title="${escapeHTML(sa.notes)}">🗒 ${highlightMatchHTML(sa.notes, currentSearchQuery)}</div>` : ''}
                </div>
            </div>

            <div class="sa-col-user">
                <span class="mono-val" title="${escapeHTML(sa.username)}">${highlightMatchHTML(sa.username || '—', currentSearchQuery)}</span>
                <button type="button" class="copy-pill-btn btn-copy-user" title="Copy Tài khoản / Email">👤 Copy</button>
            </div>

            <div class="sa-col-pwd">
                <span class="mono-val pwd-val">${sa.password ? (isRev ? escapeHTML(sa.password) : '••••••••••••') : '—'}</span>
                ${dupCount > 1 ? `<span class="health-dot dup" title="Dùng chung với ${dupCount - 1} tài khoản khác">●</span>` : ''}
                ${weak ? `<span class="health-dot weak" title="Mật khẩu yếu (<8 ký tự hoặc đơn giản)">!</span>` : ''}
                <button type="button" class="icon-btn btn-eye" title="Hiện/Ẩn Mật khẩu">${isRev ? '🙈' : '👁'}</button>
                <button type="button" class="copy-pill-btn primary-copy btn-copy-pwd" title="Copy Mật khẩu">🔑 Copy MK</button>
                ${sa.notes ? `<button type="button" class="icon-btn btn-copy-2fa" title="Copy Ghi chú / Mã 2FA">🗒</button>` : ''}
            </div>
        `;

        row.querySelector('.btn-sa-star')?.addEventListener('click', () => {
            toggleSubAccountFavorite(item, sa);
        });
        row.querySelector('.btn-copy-user')?.addEventListener('click', (e) => {
            copyToClipboard(sa.username, e.currentTarget as HTMLElement);
        });
        row.querySelector('.btn-copy-pwd')?.addEventListener('click', (e) => {
            copyToClipboard(sa.password, e.currentTarget as HTMLElement);
        });
        row.querySelector('.btn-copy-2fa')?.addEventListener('click', () => {
            copyToClipboard(sa.notes || '');
        });
        row.querySelector('.btn-eye')?.addEventListener('click', () => {
            if (revealedSubPwdIds.has(sa.id)) revealedSubPwdIds.delete(sa.id);
            else revealedSubPwdIds.add(sa.id);
            renderItems();
        });

        wrap.appendChild(row);
    });

    if (item.notes?.trim()) {
        const footerNote = document.createElement('div');
        footerNote.className = 'inline-group-note';
        footerNote.innerHTML = `<strong>Ghi chú chung:</strong> ${highlightMatchHTML(item.notes, currentSearchQuery)}`;
        wrap.appendChild(footerNote);
    }

    container.appendChild(wrap);
}

function renderTable(container: HTMLElement, items: VaultItem[], health: PasswordHealthSummary): void {
    container.className = 'table-scroll-wrap';
    const table = document.createElement('table');
    table.className = 'items-table glass-panel';
    table.innerHTML = `
        <thead>
            <tr>
                <th>${currentFilter === 'notes' ? 'Tiêu đề Ghi chú' : 'Tên / Mã máy'}</th>
                <th>${currentFilter === 'notes' ? 'Trích đoạn nội dung' : 'Tài khoản / Email'}</th>
                ${currentFilter !== 'notes' ? '<th>Mật khẩu & Cảnh báo</th><th>Ghi chú / 2FA</th>' : ''}
                <th style="width: 175px;">Thao tác</th>
            </tr>
        </thead>
        <tbody id="table-body"></tbody>
    `;
    container.appendChild(table);
    const tbody = table.querySelector('#table-body')!;

    items.forEach(item => {
        const isNote = item.type === 'Note';
        const effectiveAccounts = isNote ? [] : vaultManager.getEffectiveSubAccounts(item);
        const isExpanded = expandedGroupIds.has(item.id) || (!!currentSearchQuery.trim() && !isNote && effectiveAccounts.length > 0) || items.length <= 3;
        const catMeta = getCategoryMeta(resolveItemCategory(item));
        const safeUrl = normalizeExternalUrl(item.url);

        const trGroup = document.createElement('tr');
        trGroup.className = 'table-group-row';

        if (isNote) {
            trGroup.innerHTML = `
                <td><strong>📝 ${highlightMatchHTML(item.name, currentSearchQuery)}</strong></td>
                <td class="note-cell">${highlightMatchHTML(item.notes.replace(/\n/g, ' '), currentSearchQuery)}</td>
                ${currentFilter !== 'notes' ? '<td colspan="2" style="color: var(--text-secondary)">Ghi chú bảo mật</td>' : ''}
                <td>
                    <div class="item-actions">
                        ${currentFilter === 'trash' ? `
                            <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                            <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                        ` : `
                            <button class="icon-btn btn-copy-note" title="Copy Ghi chú">📋</button>
                            <button class="icon-btn btn-fav" title="Yêu thích">${item.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-edit" title="Xem/Sửa">✏️</button>
                            <button class="icon-btn btn-del" title="Xóa">🗑️</button>
                        `}
                    </div>
                </td>
            `;
        } else {
            trGroup.innerHTML = `
                <td colspan="4" class="group-toggle-cell">
                    <span class="chevron">${isExpanded ? '▾' : '▸'}</span>
                    <span>${catMeta.icon}</span>
                    <strong>${highlightMatchHTML(item.name, currentSearchQuery)}</strong>
                    <span class="count-badge">${effectiveAccounts.length} tài khoản</span>
                    ${item.url ? `<span class="url-text" style="margin-left: 8px; font-size: 12px;">${escapeHTML(item.url)}</span>` : ''}
                </td>
                <td>
                    <div class="item-actions">
                        ${currentFilter === 'trash' ? `
                            <button class="icon-btn btn-restore" title="Khôi phục">♻️</button>
                            <button class="icon-btn btn-hard-del" title="Xóa vĩnh viễn">🔥</button>
                        ` : `
                            ${safeUrl ? `<button class="icon-btn btn-open-url" title="Mở URL">🔗</button>` : ''}
                            <button class="icon-btn btn-fav" title="Yêu thích">${item.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-edit" title="Sửa nhóm">✏️</button>
                            <button class="icon-btn btn-del" title="Xóa nhóm">🗑️</button>
                        `}
                    </div>
                </td>
            `;
            trGroup.querySelector('.group-toggle-cell')?.addEventListener('click', () => {
                if (expandedGroupIds.has(item.id)) expandedGroupIds.delete(item.id);
                else expandedGroupIds.add(item.id);
                renderItems();
            });
        }

        attachCardEvents(trGroup, item, safeUrl);
        tbody.appendChild(trGroup);

        if (!isNote && isExpanded && currentFilter !== 'trash') {
            effectiveAccounts.forEach(sa => {
                const isRev = revealedSubPwdIds.has(sa.id);
                const dupCount = sa.password ? (health.duplicatePasswordsCount.get(sa.password) || 0) : 0;
                const weak = isWeakPassword(sa.password);
                const trSub = document.createElement('tr');
                trSub.className = 'sub-account-row';
                trSub.innerHTML = `
                    <td>
                        ↳ <span>${highlightMatchHTML(sa.label || 'Chưa đặt tên', currentSearchQuery)}</span>
                        ${sa.pcCode ? `<span class="pc-badge">${highlightMatchHTML(sa.pcCode, currentSearchQuery)}</span>` : ''}
                    </td>
                    <td class="mono-cell">${highlightMatchHTML(sa.username || '—', currentSearchQuery)}</td>
                    <td class="mono-cell">
                        <span>${sa.password ? (isRev ? escapeHTML(sa.password) : '••••••••') : '—'}</span>
                        ${dupCount > 1 ? `<span class="health-pill dup mini">Trùng x${dupCount}</span>` : ''}
                        ${weak ? `<span class="health-pill weak mini">Yếu</span>` : ''}
                    </td>
                    <td class="note-cell" title="${escapeHTML(sa.notes || '')}">${highlightMatchHTML(sa.notes || '—', currentSearchQuery)}</td>
                    <td>
                        <div class="item-actions">
                            <button class="icon-btn btn-fav-sa" title="Yêu thích">${sa.favorite ? '⭐' : '☆'}</button>
                            <button class="icon-btn btn-eye-sa" title="Hiện/Ẩn MK">${isRev ? '🙈' : '👁'}</button>
                            <button class="icon-btn btn-copy-sa-user" title="Copy User">👤</button>
                            <button class="icon-btn btn-copy-sa-pwd" title="Copy Mật khẩu">🔑</button>
                        </div>
                    </td>
                `;
                trSub.querySelector('.btn-fav-sa')?.addEventListener('click', () => toggleSubAccountFavorite(item, sa));
                trSub.querySelector('.btn-eye-sa')?.addEventListener('click', () => {
                    if (revealedSubPwdIds.has(sa.id)) revealedSubPwdIds.delete(sa.id);
                    else revealedSubPwdIds.add(sa.id);
                    renderItems();
                });
                trSub.querySelector('.btn-copy-sa-user')?.addEventListener('click', () => copyToClipboard(sa.username));
                trSub.querySelector('.btn-copy-sa-pwd')?.addEventListener('click', () => copyToClipboard(sa.password));
                tbody.appendChild(trSub);
            });
        }
    });
}

function renderHealthView(container: HTMLElement, health: PasswordHealthSummary): void {
    container.className = 'health-dashboard';
    container.innerHTML = `
        <div class="health-kpi-grid">
            <div class="kpi-card glass-panel">
                <div class="kpi-val">${health.totalAccounts}</div>
                <div class="kpi-lbl">Tổng tài khoản đang quản lý</div>
            </div>
            <div class="kpi-card glass-panel ${health.duplicateAccounts > 0 ? 'warn' : 'ok'}">
                <div class="kpi-val">${health.duplicateAccounts}</div>
                <div class="kpi-lbl">Tài khoản dùng trùng mật khẩu</div>
            </div>
            <div class="kpi-card glass-panel ${health.weakAccounts > 0 ? 'danger' : 'ok'}">
                <div class="kpi-val">${health.weakAccounts}</div>
                <div class="kpi-lbl">Mật khẩu yếu (&lt; 8 ký tự / đơn giản)</div>
            </div>
        </div>
        <div id="health-entries-box" class="glass-panel" style="padding: 16px;"></div>
    `;

    const box = container.querySelector('#health-entries-box') as HTMLElement;
    if (health.entries.length === 0) {
        box.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--success-color);">🎉 Tuyệt vời! Không có mật khẩu nào bị trùng lặp hoặc quá yếu.</div>`;
        return;
    }

    box.innerHTML = `
        <h4 style="margin-bottom: 12px;">Danh sách tài khoản nên tách / nâng cấp mật khẩu (${health.entries.length})</h4>
        <div class="health-list"></div>
    `;
    const listEl = box.querySelector('.health-list')!;
    health.entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'health-row';
        row.innerHTML = `
            <div>
                <strong>${escapeHTML(entry.label)}</strong>
                ${entry.pcCode ? `<span class="pc-badge">${escapeHTML(entry.pcCode)}</span>` : ''}
                <div style="font-size: 12px; color: var(--text-secondary);">Nhóm: ${escapeHTML(entry.itemName)} • ${escapeHTML(entry.username)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${entry.duplicateCount > 1 ? `<span class="health-pill dup">Trùng ${entry.duplicateCount} TK</span>` : ''}
                ${entry.isWeak ? `<span class="health-pill weak">MK yếu</span>` : ''}
                <button type="button" class="action-btn outline small-btn btn-health-fix">✏️ Sửa nhóm này</button>
            </div>
        `;
        row.querySelector('.btn-health-fix')?.addEventListener('click', () => {
            const targetItem = vaultManager.getItem(entry.itemId);
            if (targetItem) openModal(targetItem);
        });
        listEl.appendChild(row);
    });
}

function toggleSubAccountFavorite(item: VaultItem, targetSa: SubAccount): void {
    const accounts = vaultManager.getEffectiveSubAccounts(item).map(s =>
        s.id === targetSa.id ? { ...s, favorite: !targetSa.favorite } : s
    );
    vaultManager.updateItem(item.id, { subAccounts: accounts, username: '', password: '' });
    renderItems();
    showGlobalToast(!targetSa.favorite ? 'Đã thêm vào Yêu thích' : 'Đã bỏ Yêu thích', 'info');
}

function attachCardEvents(el: HTMLElement, item: VaultItem, safeUrl: string | null): void {
    if (currentFilter !== 'trash') {
        el.querySelector('.btn-open-url')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (safeUrl) openSafeExternalUrl(safeUrl);
        });
        el.querySelector('.btn-fav')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.updateItem(item.id, { favorite: !item.favorite });
            renderItems();
            showGlobalToast(!item.favorite ? 'Đã thêm vào Yêu thích' : 'Đã bỏ Yêu thích', 'info');
        });
        el.querySelector('.btn-copy-note')?.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(item.notes);
        });
        el.querySelector('.btn-clone')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.cloneItem(item.id);
            renderItems();
            showGlobalToast('Đã nhân bản nhóm!', 'success');
        });
        el.querySelector('.btn-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal(item);
        });
        el.querySelector('.btn-del')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.moveToTrash(item.id);
            renderItems();
            showGlobalToast('Đã chuyển vào Thùng rác', 'info');
        });
    } else {
        el.querySelector('.btn-restore')?.addEventListener('click', (e) => {
            e.stopPropagation();
            vaultManager.restoreFromTrash(item.id);
            renderItems();
            showGlobalToast('Đã khôi phục mục từ Thùng rác', 'success');
        });
        el.querySelector('.btn-hard-del')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Xóa vĩnh viễn "${item.name}"? Hành động này không thể hoàn tác!`)) {
                vaultManager.permanentlyDelete(item.id);
                renderItems();
                showGlobalToast('Đã xóa vĩnh viễn', 'info');
            }
        });
    }
}

function openModal(item?: VaultItem): void {
    const modal = document.getElementById('item-modal');
    const form = document.getElementById('item-form') as HTMLFormElement;
    document.getElementById('modal-title')!.textContent = item ? `Chỉnh sửa: ${item.name}` : 'Thêm Mục Mới';

    form.reset();
    document.getElementById('sub-accounts-container')!.innerHTML = '';
    historyRevealed = false;
    const histBtn = document.getElementById('btn-toggle-history-vis');
    if (histBtn) histBtn.textContent = '👁 Hiện tất cả';

    let isNote = false;
    const catSelect = document.getElementById('item-category') as HTMLSelectElement;

    if (item) {
        editItemId = item.id;
        isNote = item.type === 'Note';

        (document.querySelector(`input[name="item-type"][value="${isNote ? 'Note' : 'Account'}"]`) as HTMLInputElement).checked = true;
        (document.getElementById('item-name') as HTMLInputElement).value = item.name;
        (document.getElementById('item-url') as HTMLInputElement).value = item.url || '';
        (document.getElementById('item-notes') as HTMLTextAreaElement).value = item.notes || '';
        if (catSelect) catSelect.value = resolveItemCategory(item);

        const accountsToRender = vaultManager.getEffectiveSubAccounts(item);
        accountsToRender.forEach(sa => addSubAccountRow(sa));

        const historySection = document.getElementById('history-section');
        const historyList = document.getElementById('password-history-list');
        if (!isNote && item.passwordHistory && item.passwordHistory.length > 0) {
            historySection?.classList.remove('hidden');
            if (historyList) {
                historyList.innerHTML = item.passwordHistory.map(h => `
                    <div class="history-item">
                        <span class="history-time">
                            ${new Date(h.changedAt).toLocaleString('vi-VN')}
                            <br><small style="color:var(--text-secondary)">↳ ${escapeHTML(h.targetLabel || 'Tài khoản chính')}</small>
                        </span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="history-pwd" data-raw="${escapeHTML(h.password)}">••••••••••••</span>
                            <button type="button" class="mini-btn btn-copy-hist" data-raw="${escapeHTML(h.password)}" title="Copy MK cũ">📋</button>
                        </div>
                    </div>
                `).join('');
                historyList.querySelectorAll('.btn-copy-hist').forEach(btn => {
                    btn.addEventListener('click', () => {
                        copyToClipboard((btn as HTMLElement).dataset.raw || '');
                    });
                });
            }
        } else {
            historySection?.classList.add('hidden');
        }
    } else {
        editItemId = null;
        document.getElementById('history-section')?.classList.add('hidden');
        (document.querySelector('input[name="item-type"][value="Account"]') as HTMLInputElement).checked = true;
        if (catSelect) catSelect.value = currentCatFilter === 'all' ? 'Email' : currentCatFilter;
        addSubAccountRow();
    }

    toggleFormFields(isNote ? 'Note' : 'Account');
    modal?.classList.remove('hidden');
    setTimeout(() => {
        (document.getElementById('item-name') as HTMLInputElement).focus();
    }, 60);
}

function closeModal(): void {
    document.getElementById('item-modal')?.classList.add('hidden');
    editItemId = null;
}

function saveItem(): void {
    const typeValue = (document.querySelector('input[name="item-type"]:checked') as HTMLInputElement).value;
    const name = (document.getElementById('item-name') as HTMLInputElement).value.trim();
    const url = (document.getElementById('item-url') as HTMLInputElement).value.trim();
    const notes = (document.getElementById('item-notes') as HTMLTextAreaElement).value;
    const folder = (document.getElementById('item-category') as HTMLSelectElement)?.value || 'Other';

    const subAccounts: SubAccount[] = [];

    if (typeValue === 'Account') {
        document.querySelectorAll('#sub-accounts-container .sub-account-group').forEach(group => {
            const saId = (group.querySelector('.sa-id') as HTMLInputElement).value || crypto.randomUUID();
            const rawLabel = (group.querySelector('.sa-label') as HTMLInputElement).value.trim();
            const pcCode = (group.querySelector('.sa-pc') as HTMLInputElement).value.trim();
            const saUser = (group.querySelector('.sa-username') as HTMLInputElement).value.trim();
            const saPwd = (group.querySelector('.sa-password') as HTMLInputElement).value;
            const saNotes = (group.querySelector('.sa-notes') as HTMLInputElement).value.trim();
            const isFav = (group.querySelector('.sa-fav-val') as HTMLInputElement).value === '1';

            if (rawLabel || saUser || saPwd || pcCode || saNotes) {
                const label = rawLabel || saUser || pcCode || 'Tài khoản';
                subAccounts.push({
                    id: saId,
                    label,
                    pcCode: pcCode || undefined,
                    username: saUser,
                    password: saPwd,
                    notes: saNotes || undefined,
                    favorite: isFav
                });
            }
        });
    }

    if (editItemId) {
        vaultManager.updateItem(editItemId, {
            name,
            username: '',
            password: '',
            url,
            notes,
            folder,
            subAccounts,
            type: typeValue as ItemType
        });
        showGlobalToast('Đã cập nhật mục!', 'success');
    } else {
        const created = vaultManager.addItem({
            name,
            username: '',
            password: '',
            url,
            notes,
            subAccounts,
            type: typeValue as ItemType,
            tags: [],
            folder,
            favorite: false,
            customFields: [],
            expiresAt: null
        });
        expandedGroupIds.add(created.id);
        showGlobalToast('Đã thêm mục mới!', 'success');
    }

    closeModal();
    renderItems();
}

function normalizeExternalUrl(raw: string): string | null {
    const t = (raw || '').trim();
    if (!t) return null;
    if (/^(javascript|data|vbscript):/i.test(t)) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
    return null;
}

function openSafeExternalUrl(raw: string): void {
    const url = normalizeExternalUrl(raw);
    if (!url) {
        showGlobalToast('Địa chỉ URL không hợp lệ!', 'error');
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyToClipboard(text: string, feedbackBtn?: HTMLElement): Promise<void> {
    if (!text) {
        showGlobalToast('Trường này đang trống!', 'info');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    if (feedbackBtn) {
        const prev = feedbackBtn.textContent;
        feedbackBtn.textContent = '✓ Đã chép';
        feedbackBtn.classList.add('copied-ok');
        setTimeout(() => {
            feedbackBtn.textContent = prev;
            feedbackBtn.classList.remove('copied-ok');
        }, 1200);
    }

    showGlobalToast('Đã copy vào bộ nhớ tạm (Tự xóa sau 20s)', 'success');

    clearTimeout(clipboardTimeout);
    clipboardTimeout = window.setTimeout(async () => {
        try {
            await navigator.clipboard.writeText('');
        } catch {
            // Bỏ qua nếu tab mất focus
        }
    }, 20000);
}

function highlightMatchHTML(text: string, rawQuery: string): string {
    if (!text) return '';
    const cleanQ = normalizeVietnamese(rawQuery).trim();
    if (!cleanQ) return escapeHTML(text);

    // Ánh xạ từng ký tự gốc sang dạng không dấu để bôi sáng chính xác tiếng Việt có dấu
    const tokens = cleanQ.split(/\s+/).filter(t => t.length >= 1);
    const chars = Array.from(text);
    let normStr = '';
    const normToCharIdx: number[] = [];

    chars.forEach((ch, idx) => {
        const normCh = normalizeVietnamese(ch);
        for (let k = 0; k < normCh.length; k++) {
            normStr += normCh[k];
            normToCharIdx.push(idx);
        }
    });

    const matchedCharFlags = new Array<boolean>(chars.length).fill(false);
    for (const token of tokens) {
        let pos = 0;
        while (pos < normStr.length) {
            const found = normStr.indexOf(token, pos);
            if (found === -1) break;
            for (let i = found; i < found + token.length; i++) {
                matchedCharFlags[normToCharIdx[i]] = true;
            }
            pos = found + token.length;
        }
    }

    let out = '';
    let inMark = false;
    for (let i = 0; i < chars.length; i++) {
        if (matchedCharFlags[i] && !inMark) {
            out += '<mark class="hl">';
            inMark = true;
        } else if (!matchedCharFlags[i] && inMark) {
            out += '</mark>';
            inMark = false;
        }
        out += escapeHTML(chars[i]);
    }
    if (inMark) out += '</mark>';
    return out;
}

function escapeHTML(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
