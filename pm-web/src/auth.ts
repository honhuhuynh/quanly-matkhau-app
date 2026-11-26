import { encryptVault, decryptVault, extractHint } from './crypto';
import { VaultManager } from './vault';
import type { Vault, VaultItem } from './types';
import { initUI, showGlobalToast } from './ui';
import {
    listAvailableVaults,
    fetchVaultData,
    saveVaultData,
    getGithubConfig,
    saveGithubConfig,
    getActiveStorageMode,
    notifySyncState,
    clearCachedSha,
    type StorageMode
} from './storage';

const AUTO_LOCK_MINUTES = 10;

export interface SessionActions {
    getVaultName: () => string;
    getStorageMode: () => StorageMode;
    getCurrentHint: () => string;
    lockVault: (reason?: string) => void;
    syncNow: () => Promise<void>;
    changeMasterPassword: (oldPwd: string, newPwd: string, newHint: string) => Promise<void>;
    exportEncryptedVault: () => Promise<{ filename: string; content: string }>;
    decryptExternalBackup: (rawContent: string, pwd: string) => Promise<VaultItem[]>;
    commitManualSave: () => Promise<void>;
    onAutoLockRemainingChange: (cb: (secondsLeft: number) => void) => () => void;
    touchActivity: () => void;
}

export function initAuthFlow(vaultManager: VaultManager) {
    const loginOverlay = document.getElementById('login-overlay');
    const appLayout = document.getElementById('app');

    const loginForm = document.getElementById('login-form') as HTMLFormElement;
    const setupForm = document.getElementById('setup-form') as HTMLFormElement;
    const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
    const modeBadge = document.getElementById('login-mode-badge');
    const quickChips = document.getElementById('vault-quick-chips');

    const loginVaultName = document.getElementById('login-vault-name') as HTMLInputElement;
    const loginPassword = document.getElementById('login-password') as HTMLInputElement;
    const hintDisplay = document.getElementById('hint-display');
    const loginError = document.getElementById('login-error');
    const btnForgot = document.getElementById('btn-forgot') as HTMLButtonElement;
    const btnLoginSubmit = document.getElementById('btn-login-submit') as HTMLButtonElement;

    const setupVaultNameDisplay = document.getElementById('setup-vault-name-display');
    const setupPassword = document.getElementById('setup-password') as HTMLInputElement;
    const setupPasswordConfirm = document.getElementById('setup-password-confirm') as HTMLInputElement;
    const setupHint = document.getElementById('setup-hint') as HTMLInputElement;
    const setupError = document.getElementById('setup-error');
    const btnCancelSetup = document.getElementById('btn-cancel-setup');
    const btnSetupSubmit = document.getElementById('btn-setup-submit') as HTMLButtonElement;
    const strengthLabel = document.getElementById('strength-label');
    const pwdStrengthDiv = document.getElementById('pwd-strength');

    // Trạng thái phiên làm việc hiện tại (chỉ lưu trong RAM)
    let activeVaultName = '';
    let activeMasterPwd = '';
    let activeHint = '';
    let saveQueue: Promise<void> = Promise.resolve();
    let hooksAttached = false;
    let idleTimerId: number | null = null;
    let remainingSeconds = AUTO_LOCK_MINUTES * 60;
    const lockTickListeners = new Set<(seconds: number) => void>();

    function updateModeBadge() {
        if (!modeBadge) return;
        const mode = getActiveStorageMode();
        if (mode === 'github') {
            const cfg = getGithubConfig();
            modeBadge.textContent = `☁️ GitHub: ${cfg?.repo}`;
            modeBadge.className = 'mode-badge cloud';
        } else {
            modeBadge.textContent = '💾 Chế độ Offline (Lưu cục bộ)';
            modeBadge.className = 'mode-badge offline';
        }
    }

    async function refreshVaultOptions() {
        updateModeBadge();
        const datalist = document.getElementById('available-vaults');
        if (datalist) datalist.innerHTML = '';
        if (quickChips) quickChips.innerHTML = '';

        const vaults = await listAvailableVaults();
        for (const vaultName of vaults) {
            if (datalist) {
                const option = document.createElement('option');
                option.value = vaultName;
                datalist.appendChild(option);
            }
            if (quickChips) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'vault-chip';
                chip.textContent = `🔐 ${vaultName}`;
                chip.addEventListener('click', () => {
                    loginVaultName.value = vaultName;
                    quickChips.querySelectorAll('.vault-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    loginPassword.focus();
                });
                quickChips.appendChild(chip);
            }
        }
    }

    // Toggle Hiện/Ẩn mật khẩu cho các màn hình auth
    document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget as HTMLButtonElement;
            const input = targetBtn.previousElementSibling as HTMLInputElement;
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            targetBtn.textContent = showing ? '👁' : '🙈';
        });
    });

    function checkStrength(pwd: string) {
        if (!pwd) return { label: 'Chưa nhập', class: '' };
        let score = 0;
        if (pwd.length >= 8) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^A-Za-z0-9]/.test(pwd)) score++;

        if (score < 2 || pwd.length < 6) return { label: 'Yếu (Cần ít nhất 6 ký tự + chữ hoa/số)', class: 'weak' };
        if (score === 2) return { label: 'Trung bình', class: 'medium' };
        return { label: 'Mạnh', class: 'strong' };
    }

    function validateSetupForm() {
        const pwd = setupPassword.value;
        const confirm = setupPasswordConfirm.value;
        const strength = checkStrength(pwd);

        if (strengthLabel && pwdStrengthDiv) {
            strengthLabel.textContent = strength.label;
            pwdStrengthDiv.className = `pwd-strength ${strength.class}`;
        }

        const invalid = !pwd || pwd !== confirm || strength.class === 'weak';
        btnSetupSubmit.disabled = invalid;
        btnSetupSubmit.style.opacity = invalid ? '0.5' : '1';
        btnSetupSubmit.style.cursor = invalid ? 'not-allowed' : 'pointer';
    }

    setupPassword.addEventListener('input', validateSetupForm);
    setupPasswordConfirm.addEventListener('input', validateSetupForm);

    function startIdleTimer() {
        stopIdleTimer();
        remainingSeconds = AUTO_LOCK_MINUTES * 60;
        lockTickListeners.forEach(cb => cb(remainingSeconds));
        idleTimerId = window.setInterval(() => {
            if (!activeVaultName) return;
            remainingSeconds--;
            lockTickListeners.forEach(cb => cb(remainingSeconds));
            if (remainingSeconds <= 0) {
                lockVault(`Đã tự động khóa két "${activeVaultName}" do không thao tác trong ${AUTO_LOCK_MINUTES} phút.`);
            }
        }, 1000);
    }

    function stopIdleTimer() {
        if (idleTimerId !== null) {
            clearInterval(idleTimerId);
            idleTimerId = null;
        }
    }

    function touchActivity() {
        if (!activeVaultName) return;
        remainingSeconds = AUTO_LOCK_MINUTES * 60;
    }

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, touchActivity, { passive: true });
    });

    function lockVault(reason?: string) {
        stopIdleTimer();
        activeVaultName = '';
        activeMasterPwd = '';
        activeHint = '';
        vaultManager.getVault().items = [];
        loginPassword.value = '';
        loginError?.classList.add('hidden');
        hintDisplay?.classList.add('hidden');

        // Đóng các modal đang mở nếu có
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        appLayout?.classList.add('hidden');
        loginOverlay?.classList.remove('hidden');

        if (reason && loginError) {
            loginError.textContent = reason;
            loginError.classList.remove('hidden');
        }
        refreshVaultOptions();
    }

    function queueSaveToStorage(): Promise<void> {
        const targetVault = activeVaultName;
        const targetPwd = activeMasterPwd;
        const targetHint = activeHint;
        if (!targetVault || !targetPwd) return Promise.resolve();

        const snapshotJson = JSON.stringify(vaultManager.getVault());
        saveQueue = saveQueue
            .catch(() => {}) // không để lỗi trước làm kẹt các lần lưu sau
            .then(async () => {
                const encrypted = await encryptVault(snapshotJson, targetPwd, targetHint);
                await saveVaultData(targetVault, encrypted);
            });

        saveQueue.catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Lỗi đồng bộ';
            showGlobalToast(msg, 'error');
        });

        return saveQueue;
    }

    function attachMutationHooks() {
        if (hooksAttached) return;
        hooksAttached = true;

        const origAdd = vaultManager.addItem.bind(vaultManager);
        const origUpdate = vaultManager.updateItem.bind(vaultManager);
        const origMoveTrash = vaultManager.moveToTrash.bind(vaultManager);
        const origRestore = vaultManager.restoreFromTrash.bind(vaultManager);
        const origHardDel = vaultManager.permanentlyDelete.bind(vaultManager);

        vaultManager.addItem = (...args) => {
            const res = origAdd(...args);
            queueSaveToStorage();
            return res;
        };
        vaultManager.updateItem = (...args) => {
            const res = origUpdate(...args);
            queueSaveToStorage();
            return res;
        };
        vaultManager.moveToTrash = (...args) => {
            origMoveTrash(...args);
            queueSaveToStorage();
        };
        vaultManager.restoreFromTrash = (...args) => {
            origRestore(...args);
            queueSaveToStorage();
        };
        vaultManager.permanentlyDelete = (...args) => {
            origHardDel(...args);
            queueSaveToStorage();
        };
    }

    const sessionActions: SessionActions = {
        getVaultName: () => activeVaultName,
        getStorageMode: () => getActiveStorageMode(),
        getCurrentHint: () => activeHint,
        lockVault,
        syncNow: async () => {
            if (!activeVaultName || !activeMasterPwd) return;
            if (getActiveStorageMode() === 'offline') {
                await queueSaveToStorage();
                showGlobalToast('Đang ở chế độ Offline — Dữ liệu đã được lưu an toàn trên máy.', 'success');
                return;
            }
            try {
                notifySyncState('saving', 'Đang đồng bộ hai chiều với GitHub...');
                await saveQueue.catch(() => {});
                const remoteEncrypted = await fetchVaultData(activeVaultName);
                if (remoteEncrypted) {
                    const decryptedJson = await decryptVault(remoteEncrypted, activeMasterPwd);
                    const remoteVault = JSON.parse(decryptedJson) as Vault;
                    activeHint = extractHint(remoteEncrypted);
                    vaultManager.getVault().items = remoteVault.items || [];
                } else {
                    await queueSaveToStorage();
                }
                const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                notifySyncState('saved', `Đã đồng bộ mới nhất lúc ${timeStr}`);
                initUI(vaultManager, sessionActions);
                showGlobalToast('Đã đồng bộ dữ liệu mới nhất từ GitHub!', 'success');
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Đồng bộ thất bại';
                notifySyncState('error', msg);
                showGlobalToast(msg, 'error');
            }
        },
        changeMasterPassword: async (oldPwd: string, newPwd: string, newHint: string) => {
            if (oldPwd !== activeMasterPwd) {
                throw new Error('Mật khẩu hiện tại không chính xác!');
            }
            activeMasterPwd = newPwd;
            activeHint = newHint;
            await queueSaveToStorage();
        },
        exportEncryptedVault: async () => {
            const encrypted = await encryptVault(
                JSON.stringify(vaultManager.getVault()),
                activeMasterPwd,
                activeHint
            );
            const dateTag = new Date().toISOString().slice(0, 10);
            return {
                filename: `vault_${activeVaultName}_backup_${dateTag}.enc`,
                content: encrypted
            };
        },
        decryptExternalBackup: async (rawContent: string, pwd: string) => {
            const jsonText = await decryptVault(rawContent, pwd);
            const parsed = JSON.parse(jsonText) as Vault;
            if (!parsed || !Array.isArray(parsed.items)) {
                throw new Error('File backup không đúng định dạng két sắt!');
            }
            return parsed.items;
        },
        commitManualSave: () => queueSaveToStorage(),
        onAutoLockRemainingChange: (cb) => {
            lockTickListeners.add(cb);
            cb(remainingSeconds);
            return () => lockTickListeners.delete(cb);
        },
        touchActivity
    };

    refreshVaultOptions();
    attachMutationHooks();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const vaultName = loginVaultName.value.trim();
        const pwd = loginPassword.value;
        if (!vaultName || !pwd) return;

        loginError?.classList.add('hidden');
        hintDisplay?.classList.add('hidden');

        const oldBtnText = btnLoginSubmit.textContent;
        btnLoginSubmit.textContent = 'Đang giải mã...';
        btnLoginSubmit.disabled = true;

        let savedData: string | null = null;
        try {
            savedData = await fetchVaultData(vaultName);
        } catch (err: unknown) {
            btnLoginSubmit.textContent = oldBtnText;
            btnLoginSubmit.disabled = false;
            if (loginError) {
                loginError.textContent = err instanceof Error ? err.message : 'Lỗi tải dữ liệu!';
                loginError.classList.remove('hidden');
            }
            return;
        }

        btnLoginSubmit.textContent = oldBtnText;
        btnLoginSubmit.disabled = false;

        if (!savedData) {
            loginForm.classList.add('hidden');
            setupForm.classList.remove('hidden');
            if (setupVaultNameDisplay) setupVaultNameDisplay.textContent = vaultName;
            setupPassword.value = '';
            setupPasswordConfirm.value = '';
            setupHint.value = '';
            validateSetupForm();
            return;
        }

        try {
            const decryptedJson = await decryptVault(savedData, pwd);
            const vaultData = JSON.parse(decryptedJson) as Vault;

            activeVaultName = vaultName;
            activeMasterPwd = pwd;
            activeHint = extractHint(savedData);
            vaultManager.getVault().items = vaultData.items || [];

            loginOverlay?.classList.add('hidden');
            appLayout?.classList.remove('hidden');

            initUI(vaultManager, sessionActions);
            notifySyncState(getActiveStorageMode() === 'github' ? 'saved' : 'offline',
                getActiveStorageMode() === 'github' ? 'Sẵn sàng (Đã kết nối GitHub)' : 'Chế độ Offline (Lưu trên trình duyệt)');
            startIdleTimer();
        } catch (err: unknown) {
            if (loginError) {
                loginError.textContent = err instanceof Error ? err.message : 'Sai mật khẩu!';
                loginError.classList.remove('hidden');
            }
        }
    });

    btnForgot?.addEventListener('click', async () => {
        const vaultName = loginVaultName.value.trim();
        if (!vaultName) {
            if (loginError) {
                loginError.textContent = 'Vui lòng nhập hoặc chọn tên Két Sắt trước!';
                loginError.classList.remove('hidden');
            }
            return;
        }

        btnForgot.textContent = 'Đang tải...';
        try {
            const savedData = await fetchVaultData(vaultName);
            btnForgot.textContent = '(?) Gợi ý';
            if (savedData) {
                const hint = extractHint(savedData);
                if (hintDisplay) {
                    hintDisplay.textContent = hint ? `Gợi ý: ${hint}` : 'Két này chưa đặt gợi ý mật khẩu.';
                    hintDisplay.classList.remove('hidden');
                }
            } else if (loginError) {
                loginError.textContent = 'Két chưa tồn tại, bấm Mở Khóa để khởi tạo két mới.';
                loginError.classList.remove('hidden');
            }
        } catch (err: unknown) {
            btnForgot.textContent = '(?) Gợi ý';
            if (loginError) {
                loginError.textContent = err instanceof Error ? err.message : 'Lỗi lấy gợi ý!';
                loginError.classList.remove('hidden');
            }
        }
    });

    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = setupPassword.value;
        const pwdConfirm = setupPasswordConfirm.value;
        const hint = setupHint.value.trim();
        const vaultName = loginVaultName.value.trim();

        if (pwd !== pwdConfirm) {
            if (setupError) {
                setupError.textContent = 'Mật khẩu xác nhận không khớp!';
                setupError.classList.remove('hidden');
            }
            return;
        }

        const oldText = btnSetupSubmit.textContent;
        try {
            btnSetupSubmit.textContent = 'Đang mã hóa & tạo két...';
            btnSetupSubmit.disabled = true;

            const emptyVault: Vault = { version: 1, items: [] };
            const encryptedPayload = await encryptVault(JSON.stringify(emptyVault), pwd, hint);
            clearCachedSha(vaultName);
            await saveVaultData(vaultName, encryptedPayload);

            btnSetupSubmit.textContent = oldText;
            btnSetupSubmit.disabled = false;

            setupForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            loginPassword.value = pwd;
            loginForm.dispatchEvent(new Event('submit'));
        } catch (err: unknown) {
            btnSetupSubmit.textContent = oldText;
            btnSetupSubmit.disabled = false;
            if (setupError) {
                setupError.textContent = 'Lỗi tạo két: ' + (err instanceof Error ? err.message : String(err));
                setupError.classList.remove('hidden');
            }
        }
    });

    btnCancelSetup?.addEventListener('click', () => {
        setupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        setupError?.classList.add('hidden');
    });

    // CÀI ĐẶT GITHUB / OFFLINE
    const btnSettingsOpen = document.getElementById('btn-settings-open');
    const btnCancelSettings = document.getElementById('btn-cancel-settings');
    const btnClearSettings = document.getElementById('btn-clear-settings');
    const settingRepo = document.getElementById('setting-repo') as HTMLInputElement;
    const settingToken = document.getElementById('setting-token') as HTMLInputElement;

    btnSettingsOpen?.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        setupForm.classList.add('hidden');
        settingsForm.classList.remove('hidden');

        const currentConfig = getGithubConfig();
        settingRepo.value = currentConfig?.repo || '';
        settingToken.value = currentConfig?.token || '';
    });

    btnCancelSettings?.addEventListener('click', () => {
        settingsForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    });

    btnClearSettings?.addEventListener('click', () => {
        settingRepo.value = '';
        settingToken.value = '';
        saveGithubConfig('', '');
        clearCachedSha();
        settingsForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        refreshVaultOptions();
    });

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveGithubConfig(settingRepo.value.trim(), settingToken.value.trim());
        clearCachedSha();
        settingsForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        refreshVaultOptions();
    });
}
