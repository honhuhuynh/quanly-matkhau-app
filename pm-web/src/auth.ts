import { encryptVault, decryptVault, extractHint } from './crypto';
import { VaultManager } from './vault';
import { initUI } from './ui';
import { listAvailableVaults, fetchVaultData, saveVaultData, getGithubConfig, saveGithubConfig } from './storage';

const STORAGE_PREFIX = 'vault_';

export function initAuthFlow(vaultManager: VaultManager) {
    const loginOverlay = document.getElementById('login-overlay');
    const appLayout = document.getElementById('app');
    
    const loginForm = document.getElementById('login-form') as HTMLFormElement;
    const setupForm = document.getElementById('setup-form') as HTMLFormElement;
    const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
    
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

    // Toggle Hiện/Ẩn mật khẩu
    document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
            if (input.type === 'password') {
                input.type = 'text';
            } else {
                input.type = 'password';
            }
        });
    });

    // Hàm kiểm tra độ mạnh MK
    function checkStrength(pwd: string) {
        if (!pwd) return { label: 'Chưa nhập', class: '' };
        let score = 0;
        if (pwd.length >= 8) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^A-Za-z0-9]/.test(pwd)) score++;
        
        if (score < 2 || pwd.length < 6) return { label: 'Yếu (Không cho phép)', class: 'weak' };
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

        if (!pwd || pwd !== confirm || strength.class === 'weak') {
            btnSetupSubmit.disabled = true;
            btnSetupSubmit.style.opacity = '0.5';
            btnSetupSubmit.style.cursor = 'not-allowed';
        } else {
            btnSetupSubmit.disabled = false;
            btnSetupSubmit.style.opacity = '1';
            btnSetupSubmit.style.cursor = 'pointer';
        }
    }

    setupPassword.addEventListener('input', validateSetupForm);
    setupPasswordConfirm.addEventListener('input', validateSetupForm);

    // Load danh sách két (Từ Github + LocalStorage)
    const datalist = document.getElementById('available-vaults');
    if (datalist) {
        listAvailableVaults().then(vaults => {
            for (const vaultName of vaults) {
                const option = document.createElement('option');
                option.value = vaultName;
                datalist.appendChild(option);
            }
        });
    }

    // Cần giữ lại data mẫu nếu user Claim Vault lần đầu
    const initialMockVaultData = JSON.parse(JSON.stringify(vaultManager.getVault()));

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const vaultName = loginVaultName.value.trim();
        const pwd = loginPassword.value;
        if (!vaultName || !pwd) return;

        loginError?.classList.add('hidden');
        hintDisplay?.classList.add('hidden');

        // Hiện trạng thái Loading để người dùng biết đang kết nối mạng
        const oldBtnText = btnLoginSubmit.textContent;
        btnLoginSubmit.textContent = "Đang lấy dữ liệu...";
        btnLoginSubmit.disabled = true;

        const savedData = await fetchVaultData(vaultName);

        btnLoginSubmit.textContent = oldBtnText;
        btnLoginSubmit.disabled = false;

        if (!savedData) {
            // Két vô chủ -> Chuyển sang màn hình Claim Vault
            loginForm.classList.add('hidden');
            setupForm.classList.remove('hidden');
            if (setupVaultNameDisplay) setupVaultNameDisplay.textContent = vaultName;
            setupPassword.value = '';
            setupPasswordConfirm.value = '';
            setupHint.value = '';
            validateSetupForm(); // Khóa nút Tạo Két ban đầu
            return;
        }

        try {
            // Giải mã
            const decryptedJson = await decryptVault(savedData, pwd);
            const vaultData = JSON.parse(decryptedJson);
            
            // Khởi tạo thành công
            vaultManager.getVault().items = vaultData.items || [];
            
            // Chuyển màn hình
            loginOverlay?.classList.add('hidden');
            appLayout?.classList.remove('hidden');
            
            // Cập nhật UI
            initUI(vaultManager);

            // Tạm thời hook saveItem để ghi ngược lại localStorage
            hookVaultSaves(vaultManager, vaultName, pwd);

        } catch (err: any) {
            if (loginError) {
                loginError.textContent = err.message || "Sai mật khẩu!";
                loginError.classList.remove('hidden');
            }
        }
    });

    btnForgot?.addEventListener('click', async () => {
        const vaultName = loginVaultName.value.trim();
        if (!vaultName) {
            if (loginError) {
                loginError.textContent = "Vui lòng nhập tên Két Sắt trước!";
                loginError.classList.remove('hidden');
            }
            return;
        }

        // Có thể hàm này sẽ chạy chậm do chờ fetchVaultData, nhưng nó chỉ trigger khi user bấm "Gợi ý"
        btnForgot.textContent = "Đang tải...";
        const savedData = await fetchVaultData(vaultName);
        btnForgot.textContent = "(?) Gợi ý";
        
        if (savedData) {
            const hint = extractHint(savedData);
            if (hintDisplay) {
                hintDisplay.textContent = hint ? `Gợi ý: ${hint}` : "Két này không có gợi ý mật khẩu.";
                hintDisplay.classList.remove('hidden');
            }
        } else {
            if (loginError) {
                loginError.textContent = "Két chưa tồn tại, hãy nhập mật khẩu bất kỳ để tạo.";
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
                setupError.textContent = "Mật khẩu xác nhận không khớp!";
                setupError.classList.remove('hidden');
            }
            return;
        }

        try {
            // Đổi text thành đang tạo
            const oldText = btnSetupSubmit.textContent;
            btnSetupSubmit.textContent = "Đang mã hóa & lưu lên Cloud...";
            btnSetupSubmit.disabled = true;

            // Lưu dữ liệu mẫu vào két mới
            const encryptedPayload = await encryptVault(JSON.stringify(initialMockVaultData), pwd, hint);
            await saveVaultData(vaultName, encryptedPayload);
            
            btnSetupSubmit.textContent = oldText;
            btnSetupSubmit.disabled = false;

            // Chuyển lại form đăng nhập và trigger click
            setupForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            loginPassword.value = pwd;
            
            loginForm.dispatchEvent(new Event('submit'));
        } catch (err: any) {
            if (setupError) {
                setupError.textContent = "Lỗi mã hóa: " + err.message;
                setupError.classList.remove('hidden');
            }
        }
    });

    btnCancelSetup?.addEventListener('click', () => {
        setupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        if (setupError) setupError.classList.add('hidden');
    });

    // CÀI ĐẶT GITHUB
    const btnSettingsOpen = document.getElementById('btn-settings-open');
    const btnCancelSettings = document.getElementById('btn-cancel-settings');
    const settingRepo = document.getElementById('setting-repo') as HTMLInputElement;
    const settingToken = document.getElementById('setting-token') as HTMLInputElement;

    btnSettingsOpen?.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        setupForm.classList.add('hidden');
        settingsForm.classList.remove('hidden');
        
        const currentConfig = getGithubConfig();
        if (currentConfig) {
            settingRepo.value = currentConfig.repo;
            settingToken.value = currentConfig.token;
        }
    });

    btnCancelSettings?.addEventListener('click', () => {
        settingsForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    });

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveGithubConfig(settingRepo.value.trim(), settingToken.value.trim());
        settingsForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        
        // Cập nhật lại danh sách Két ngay lập tức
        if (datalist) {
            datalist.innerHTML = ''; // Clear cũ
            listAvailableVaults().then(vaults => {
                for (const vaultName of vaults) {
                    const option = document.createElement('option');
                    option.value = vaultName;
                    datalist.appendChild(option);
                }
            });
        }
    });
}

function hookVaultSaves(vaultManager: VaultManager, vaultName: string, pwd: string) {
    const originalAddItem = vaultManager.addItem.bind(vaultManager);
    const originalUpdateItem = vaultManager.updateItem.bind(vaultManager);
    const originalMoveToTrash = vaultManager.moveToTrash.bind(vaultManager);
    
    async function syncToStorage() {
        const oldData = await fetchVaultData(vaultName);
        let hint = '';
        if (oldData) {
            try { hint = extractHint(oldData); } catch (e) {}
        }
        const encrypted = await encryptVault(JSON.stringify(vaultManager.getVault()), pwd, hint);
        await saveVaultData(vaultName, encrypted);
    }

    vaultManager.addItem = (...args) => {
        const res = originalAddItem(...args);
        syncToStorage();
        return res;
    };
    vaultManager.updateItem = (...args) => {
        const res = originalUpdateItem(...args);
        syncToStorage();
        return res;
    };
    vaultManager.moveToTrash = (...args) => {
        originalMoveToTrash(...args);
        syncToStorage();
    };
}
